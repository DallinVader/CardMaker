/**
 * Shared Google Drive (GIS token) session for Card Maker pages.
 * Access tokens expire ~1h; we refresh silently while the tab is open and
 * slide the local session forward on success so active use stays signed in.
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'cardmaker_drive_session_v1';
    /** Soft local session ceiling — slid forward on each successful refresh. */
    var SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
    /** Treat token as stale this long before Google's real expiry. */
    var EXPIRY_BUFFER_MS = 5 * 60 * 1000;
    /** Refresh when less than this remains (proactive). */
    var REFRESH_WHEN_REMAINING_MS = 15 * 60 * 1000;
    var SILENT_REFRESH_TIMEOUT_MS = 15000;

    var tokenClient = null;
    var accessToken = null;
    var proactiveTimer = null;
    var refreshInFlight = null;
    var clientId = '';
    var scope = 'https://www.googleapis.com/auth/drive.appdata';
    var onChange = function () {};
    var onStatus = function () {};

    function now() {
        return Date.now();
    }

    function parseExpiresInSec(tokenResponse) {
        var raw = tokenResponse && tokenResponse.expires_in;
        var n = typeof raw === 'number' ? raw : parseInt(String(raw || '3600'), 10);
        if (!isFinite(n) || n < 60) n = 3600;
        return n;
    }

    function readRecord() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (!data || !data.access_token || !data.expires_at) return null;
            var sessionEnd = data.session_expires_at != null ? data.session_expires_at : data.expires_at;
            if (now() >= sessionEnd) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return data;
        } catch (e) {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e2) { /* ignore */ }
            return null;
        }
    }

    function writeRecord(accessTok, expiresAt, sessionExpiresAt) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            access_token: accessTok,
            expires_at: expiresAt,
            session_expires_at: sessionExpiresAt
        }));
    }

    /**
     * Persist a GIS token response.
     * expires_at = absolute Google expiry (no buffer baked in).
     * session_expires_at slides forward on each successful auth so active users stay signed in.
     */
    function persistTokenResponse(tokenResponse) {
        if (!tokenResponse || !tokenResponse.access_token) return null;
        var expiresInSec = parseExpiresInSec(tokenResponse);
        var expiresAt = now() + expiresInSec * 1000;
        var sessionExpiresAt = now() + SESSION_MAX_MS;
        writeRecord(tokenResponse.access_token, expiresAt, sessionExpiresAt);
        return readRecord();
    }

    function isAccessTokenStale(data, remainingMs) {
        if (!data || !data.expires_at) return true;
        var threshold = remainingMs != null ? remainingMs : EXPIRY_BUFFER_MS;
        return now() >= (data.expires_at - threshold);
    }

    function applyToken(tok) {
        accessToken = tok || null;
        try {
            if (global.gapi && global.gapi.client) {
                if (tok) global.gapi.client.setToken({ access_token: tok });
                else global.gapi.client.setToken(null);
            }
        } catch (e) { /* ignore */ }
        try { onChange(!!tok); } catch (e2) { /* ignore */ }
        scheduleProactiveRefresh();
    }

    function clearSession() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        applyToken(null);
        if (proactiveTimer) {
            clearTimeout(proactiveTimer);
            proactiveTimer = null;
        }
    }

    function scheduleProactiveRefresh() {
        if (proactiveTimer) {
            clearTimeout(proactiveTimer);
            proactiveTimer = null;
        }
        var rec = readRecord();
        if (!rec || !tokenClient) return;
        var refreshAt = rec.expires_at - REFRESH_WHEN_REMAINING_MS;
        var delay = Math.max(30 * 1000, refreshAt - now());
        // Cap so we re-check periodically even if the tab slept past the deadline.
        if (delay > 20 * 60 * 1000) delay = 20 * 60 * 1000;
        proactiveTimer = setTimeout(function () {
            proactiveTimer = null;
            ensureFreshToken({ interactive: false, reason: 'proactive' }).then(function () {
                scheduleProactiveRefresh();
            });
        }, delay);
    }

    function setTokenClient(client) {
        tokenClient = client || null;
        scheduleProactiveRefresh();
    }

    function getTokenClient() {
        return tokenClient;
    }

    /**
     * Request a new access token from GIS.
     * @param {{ prompt?: string, interactive?: boolean }} opts
     */
    function requestToken(opts) {
        opts = opts || {};
        if (!tokenClient) return Promise.resolve(null);
        var prompt = opts.prompt != null ? opts.prompt : '';
        return new Promise(function (resolve) {
            var finished = false;
            var timer = setTimeout(function () {
                if (finished) return;
                finished = true;
                resolve(null);
            }, SILENT_REFRESH_TIMEOUT_MS);

            var prevCallback = tokenClient.callback;
            var prevError = tokenClient.error_callback;

            function finish(tr) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                try {
                    tokenClient.callback = prevCallback;
                    tokenClient.error_callback = prevError;
                } catch (e) { /* ignore */ }
                resolve(tr && tr.access_token ? tr : null);
            }

            tokenClient.callback = function (tr) {
                finish(tr);
            };
            tokenClient.error_callback = function (err) {
                // Silent refresh often fails with popup_closed / access_denied — not fatal yet.
                if (opts.interactive) {
                    console.warn('Drive token interactive error:', err);
                }
                finish(null);
            };

            try {
                tokenClient.requestAccessToken({ prompt: prompt });
            } catch (e) {
                finish(null);
            }
        });
    }

    /**
     * Ensure we have a usable access token.
     * - Prefer silent refresh when stale
     * - If silent fails and interactive:true, try one account-picker prompt (not full consent)
     * - Do NOT wipe a still-valid token if silent refresh fails early
     */
    function ensureFreshToken(opts) {
        opts = opts || {};
        if (refreshInFlight) return refreshInFlight;

        refreshInFlight = Promise.resolve().then(function () {
            var rec = readRecord();
            if (!rec) {
                applyToken(null);
                return false;
            }

            // Still fresh enough — just apply.
            if (!isAccessTokenStale(rec, EXPIRY_BUFFER_MS)) {
                applyToken(rec.access_token);
                return true;
            }

            // Near expiry / expired — refresh.
            if (!tokenClient) {
                // Keep applying the stored token; caller may init client and retry.
                applyToken(rec.access_token);
                return !isAccessTokenStale(rec, 0);
            }

            onStatus('Refreshing Google Drive session…');
            return requestToken({ prompt: '' }).then(function (tr) {
                if (tr) {
                    persistTokenResponse(tr);
                    applyToken(tr.access_token);
                    onStatus('Signed in (saved on this device).');
                    return true;
                }
                if (!opts.interactive) {
                    // Keep last token if Google might still accept it for a bit; otherwise mark unsigned.
                    if (!isAccessTokenStale(rec, 0)) {
                        applyToken(rec.access_token);
                        return true;
                    }
                    // Expired and silent failed — leave record so interactive sign-in can reuse session window,
                    // but clear in-memory token so UI shows reconnect needed.
                    applyToken(null);
                    onStatus('Session expired. Sign in with Google again.');
                    return false;
                }
                // Soft interactive (no force-consent): usually a quick account click.
                return requestToken({ prompt: 'select_account', interactive: true }).then(function (tr2) {
                    if (tr2) {
                        persistTokenResponse(tr2);
                        applyToken(tr2.access_token);
                        onStatus('Signed in (saved on this device).');
                        return true;
                    }
                    applyToken(null);
                    onStatus('Session expired. Sign in with Google again.');
                    return false;
                });
            });
        }).then(function (ok) {
            refreshInFlight = null;
            return ok;
        }, function (err) {
            refreshInFlight = null;
            throw err;
        });

        return refreshInFlight;
    }

    /**
     * Restore from localStorage after page load (token client should already be set).
     */
    function tryRestore(opts) {
        opts = opts || {};
        var rec = readRecord();
        if (!rec) {
            applyToken(null);
            return Promise.resolve(false);
        }
        applyToken(rec.access_token);
        if (isAccessTokenStale(rec, REFRESH_WHEN_REMAINING_MS)) {
            return ensureFreshToken({ interactive: !!opts.interactive });
        }
        onStatus('Signed in (saved on this device).');
        return Promise.resolve(true);
    }

    /**
     * Explicit user sign-in. Prefer empty prompt for returning users; use consent only when forced.
     */
    function signIn(opts) {
        opts = opts || {};
        if (!tokenClient) return Promise.resolve(false);
        var prompt = opts.forceConsent ? 'consent' : '';
        onStatus('Opening Google sign-in…');
        return requestToken({ prompt: prompt, interactive: true }).then(function (tr) {
            if (!tr && !opts.forceConsent) {
                // First-time or revoked — fall back to consent once.
                return requestToken({ prompt: 'consent', interactive: true });
            }
            return tr;
        }).then(function (tr) {
            if (tr && tr.access_token) {
                persistTokenResponse(tr);
                applyToken(tr.access_token);
                onStatus('Signed in (saved on this device).');
                return true;
            }
            onStatus('Sign-in failed. Check OAuth origin settings.');
            return false;
        });
    }

    function signOut() {
        clearSession();
        onStatus('Signed out.');
    }

    function init(options) {
        options = options || {};
        if (options.clientId) clientId = options.clientId;
        if (options.scope) scope = options.scope;
        if (typeof options.onChange === 'function') onChange = options.onChange;
        if (typeof options.onStatus === 'function') onStatus = options.onStatus;
        if (options.tokenClient) setTokenClient(options.tokenClient);
    }

    function createTokenClient(googleAccountsOauth2, opts) {
        opts = opts || {};
        var cid = opts.clientId || clientId;
        var sc = opts.scope || scope;
        if (!googleAccountsOauth2 || !cid) return null;
        var client = googleAccountsOauth2.initTokenClient({
            client_id: cid,
            scope: sc,
            callback: function () {},
            error_callback: function (err) {
                // Avoid alerting on background silent refresh failures.
                console.warn('GIS token client:', err);
            }
        });
        setTokenClient(client);
        return client;
    }

    // Visibility resume: when tab wakes, refresh if needed.
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            var rec = readRecord();
            if (!rec || !tokenClient) return;
            if (isAccessTokenStale(rec, REFRESH_WHEN_REMAINING_MS)) {
                ensureFreshToken({ interactive: false });
            } else {
                scheduleProactiveRefresh();
            }
        });
    }

    global.CardMakerDriveAuth = {
        STORAGE_KEY: STORAGE_KEY,
        SESSION_MAX_MS: SESSION_MAX_MS,
        EXPIRY_BUFFER_MS: EXPIRY_BUFFER_MS,
        init: init,
        createTokenClient: createTokenClient,
        setTokenClient: setTokenClient,
        getTokenClient: getTokenClient,
        readRecord: readRecord,
        persistTokenResponse: persistTokenResponse,
        isAccessTokenStale: isAccessTokenStale,
        getAccessToken: function () { return accessToken; },
        applyToken: applyToken,
        ensureFreshToken: ensureFreshToken,
        tryRestore: tryRestore,
        signIn: signIn,
        signOut: signOut,
        clearSession: clearSession,
        isSignedIn: function () { return !!accessToken && !!readRecord(); }
    };
})(typeof window !== 'undefined' ? window : this);
