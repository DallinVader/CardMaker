/**
 * Google Drive appDataFolder helpers for Card Player deck files (.cardmaker-deck.json).
 * Shares OAuth token storage with Card Maker (cardmaker_drive_session_v1).
 */
(function (global) {
    var GOOGLE_CLIENT_ID = '984239146057-o6ujksfj9qk8tmqm9c8msrpidgm6492r.apps.googleusercontent.com';
    var GOOGLE_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
    var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    var DRIVE_TOKEN_STORAGE_KEY = 'cardmaker_drive_session_v1';
    var DRIVE_TOKEN_EXPIRY_BUFFER_MS = 120000;
    var DRIVE_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
    var DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
    var DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
    var DECK_FILE_EXTENSION = '.cardmaker-deck.json';

    var gapiClientInitialized = false;
    var gisTokenClient = null;
    var driveAccessToken = null;
    var statusCb = function () {};

    function hasDriveConfig() {
        return GOOGLE_CLIENT_ID && !String(GOOGLE_CLIENT_ID).startsWith('REPLACE_');
    }

    function setStatus(message) {
        try {
            statusCb(message || '');
        } catch (e) { /* ignore */ }
    }

    function onStatus(fn) {
        statusCb = typeof fn === 'function' ? fn : function () {};
    }

    function readPersistedDriveToken() {
        try {
            var raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (!data || !data.access_token || !data.expires_at) return null;
            var sessionEnd = data.session_expires_at != null ? data.session_expires_at : data.expires_at;
            if (Date.now() >= sessionEnd - DRIVE_TOKEN_EXPIRY_BUFFER_MS) {
                localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
                return null;
            }
            return data;
        } catch (e) {
            localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
            return null;
        }
    }

    function persistDriveToken(tokenResponse) {
        if (!tokenResponse || !tokenResponse.access_token) return;
        var expiresInSec = typeof tokenResponse.expires_in === 'number' ? tokenResponse.expires_in : 3600;
        var googleExpiresAt = Date.now() + expiresInSec * 1000 - DRIVE_TOKEN_EXPIRY_BUFFER_MS;
        var sessionExpiresAt = Date.now() + DRIVE_SESSION_MAX_MS;
        try {
            var raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
            if (raw) {
                var prev = JSON.parse(raw);
                if (prev && typeof prev.session_expires_at === 'number' &&
                    Date.now() < prev.session_expires_at - DRIVE_TOKEN_EXPIRY_BUFFER_MS) {
                    sessionExpiresAt = prev.session_expires_at;
                }
            }
        } catch (e) { /* ignore */ }
        localStorage.setItem(DRIVE_TOKEN_STORAGE_KEY, JSON.stringify({
            access_token: tokenResponse.access_token,
            expires_at: googleExpiresAt,
            session_expires_at: sessionExpiresAt
        }));
    }

    function isGoogleAccessTokenStale(data) {
        return !!(data && Date.now() >= data.expires_at - DRIVE_TOKEN_EXPIRY_BUFFER_MS);
    }

    function applyDriveAccessToken(accessToken) {
        driveAccessToken = accessToken;
        if (global.gapi && global.gapi.client) {
            global.gapi.client.setToken({ access_token: accessToken });
        }
    }

    function trySilentRefreshDriveToken() {
        if (!gisTokenClient) return Promise.resolve(false);
        return new Promise(function (resolve) {
            var finished = false;
            var t = setTimeout(function () {
                if (!finished) {
                    finished = true;
                    resolve(false);
                }
            }, 12000);
            gisTokenClient.callback = function (tr) {
                if (finished) return;
                finished = true;
                clearTimeout(t);
                if (tr && tr.access_token) {
                    persistDriveToken(tr);
                    applyDriveAccessToken(tr.access_token);
                    resolve(true);
                } else {
                    resolve(false);
                }
            };
            try {
                gisTokenClient.requestAccessToken({ prompt: '' });
            } catch (e) {
                clearTimeout(t);
                resolve(false);
            }
        });
    }

    function formatGoogleInitError(err) {
        if (!err) return 'Unknown error';
        if (typeof err === 'string') return err;
        if (err.message) return err.message;
        try {
            return JSON.stringify(err);
        } catch (e) {
            return String(err);
        }
    }

    function initGoogleDriveClient(silent) {
        return new Promise(function (resolve) {
            if (!hasDriveConfig()) {
                if (!silent) setStatus('Set GOOGLE_CLIENT_ID in card-player-decks-drive.js if needed.');
                resolve(false);
                return;
            }
            if (!global.gapi || !global.google || !google.accounts || !google.accounts.oauth2) {
                if (!silent) setStatus('Google scripts are still loading. Try again shortly.');
                resolve(false);
                return;
            }
            if (gapiClientInitialized) {
                resolve(true);
                return;
            }
            global.gapi.load('client', {
                callback: function () {
                    global.gapi.client.init({ discoveryDocs: [GOOGLE_DISCOVERY_DOC] })
                        .then(function () {
                            gapiClientInitialized = true;
                            if (!gisTokenClient) {
                                gisTokenClient = google.accounts.oauth2.initTokenClient({
                                    client_id: GOOGLE_CLIENT_ID,
                                    scope: DRIVE_SCOPE,
                                    callback: function () {},
                                    error_callback: function (err) {
                                        console.error('GIS error:', err);
                                    }
                                });
                            }
                            resolve(true);
                        })
                        .catch(function (error) {
                            console.error(error);
                            if (!silent) setStatus('Google API init failed: ' + formatGoogleInitError(error));
                            resolve(false);
                        });
                },
                onerror: function () {
                    if (!silent) setStatus('gapi.load failed.');
                    resolve(false);
                }
            });
        });
    }

    function ensureDriveTokenBeforeDriveOp() {
        var stored = readPersistedDriveToken();
        if (stored && isGoogleAccessTokenStale(stored)) {
            return initGoogleDriveClient(true).then(function (ready) {
                if (ready) return trySilentRefreshDriveToken();
                return false;
            }).then(function () {
                stored = readPersistedDriveToken();
                if (stored) {
                    applyDriveAccessToken(stored.access_token);
                    return true;
                }
                return !!driveAccessToken;
            });
        }
        if (stored) {
            if (!driveAccessToken || driveAccessToken !== stored.access_token) {
                return initGoogleDriveClient(true).then(function (ready) {
                    if (!ready) return false;
                    applyDriveAccessToken(stored.access_token);
                    return true;
                });
            }
            if (global.gapi && global.gapi.client) {
                global.gapi.client.setToken({ access_token: driveAccessToken });
            }
            return Promise.resolve(true);
        }
        return Promise.resolve(!!driveAccessToken);
    }

    function driveAuthHeaders(extra) {
        var h = { Authorization: 'Bearer ' + driveAccessToken };
        if (extra) {
            Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        }
        return h;
    }

    function parseDriveError(text, status) {
        try {
            var j = JSON.parse(text);
            if (j.error) {
                return (j.error.message || JSON.stringify(j.error)) +
                    (j.error.errors && j.error.errors[0] && j.error.errors[0].reason
                        ? ' (' + j.error.errors[0].reason + ')' : '');
            }
        } catch (e) { /* ignore */ }
        return text || ('HTTP ' + status);
    }

    function listAppDataFolderFiles() {
        var u = new URL(DRIVE_FILES_API);
        u.searchParams.set('spaces', 'appDataFolder');
        u.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size)');
        u.searchParams.set('pageSize', '100');
        return fetch(u.toString(), { headers: driveAuthHeaders() })
            .then(function (res) { return res.text().then(function (text) { return { res: res, text: text }; }); })
            .then(function (o) {
                if (!o.res.ok) throw new Error(parseDriveError(o.text, o.res.status));
                var data = JSON.parse(o.text);
                return data.files || [];
            });
    }

    function listDeckFiles() {
        return listAppDataFolderFiles().then(function (files) {
            return files.filter(function (f) {
                return f.name && String(f.name).toLowerCase().endsWith(DECK_FILE_EXTENSION.toLowerCase());
            });
        });
    }

    function driveCreateAppDataMetadata(fileName) {
        var u = new URL(DRIVE_FILES_API);
        u.searchParams.set('fields', 'id,name');
        return fetch(u.toString(), {
            method: 'POST',
            headers: driveAuthHeaders({ 'Content-Type': 'application/json; charset=UTF-8' }),
            body: JSON.stringify({
                name: fileName,
                mimeType: 'application/json',
                parents: ['appDataFolder']
            })
        }).then(function (res) { return res.text().then(function (text) { return { res: res, text: text }; }); })
            .then(function (o) {
                if (!o.res.ok) throw new Error(parseDriveError(o.text, o.res.status));
                return JSON.parse(o.text);
            });
    }

    function driveUploadMedia(fileId, body) {
        var u = new URL(DRIVE_UPLOAD_API + '/' + encodeURIComponent(fileId));
        u.searchParams.set('uploadType', 'media');
        return fetch(u.toString(), {
            method: 'PATCH',
            headers: driveAuthHeaders({ 'Content-Type': 'application/json; charset=UTF-8' }),
            body: body
        }).then(function (res) { return res.text().then(function (text) { return { res: res, text: text }; }); })
            .then(function (o) {
                if (!o.res.ok) throw new Error(parseDriveError(o.text, o.res.status));
            });
    }

    function findDeckFileByName(fileName) {
        return listDeckFiles().then(function (files) {
            for (var i = 0; i < files.length; i++) {
                if (files[i].name === fileName) return files[i];
            }
            return null;
        });
    }

    function saveDeckToDrive(fileName, jsonString) {
        return findDeckFileByName(fileName).then(function (existing) {
            if (existing && existing.id) {
                return driveUploadMedia(existing.id, jsonString);
            }
            return driveCreateAppDataMetadata(fileName).then(function (created) {
                if (!created || !created.id) throw new Error('Drive create returned no file id.');
                return driveUploadMedia(created.id, jsonString);
            });
        });
    }

    function fetchDriveFileMedia(fileId) {
        var mediaUrl = DRIVE_FILES_API + '/' + encodeURIComponent(fileId) + '?alt=media';
        return fetch(mediaUrl, { headers: driveAuthHeaders() })
            .then(function (res) { return res.text().then(function (text) { return { res: res, text: text }; }); })
            .then(function (o) {
                if (!o.res.ok) throw new Error(parseDriveError(o.text, o.res.status));
                return o.text;
            });
    }

    function deleteDriveFile(fileId) {
        var u = DRIVE_FILES_API + '/' + encodeURIComponent(fileId);
        return fetch(u, { method: 'DELETE', headers: driveAuthHeaders() })
            .then(function (res) {
                if (res.status === 204 || res.ok) return;
                return res.text().then(function (text) {
                    throw new Error(parseDriveError(text, res.status));
                });
            });
    }

    function tryRestoreSession() {
        var stored = readPersistedDriveToken();
        if (!stored) return Promise.resolve(false);
        return initGoogleDriveClient(true).then(function (ready) {
            if (!ready) return false;
            applyDriveAccessToken(stored.access_token);
            if (isGoogleAccessTokenStale(stored)) {
                return trySilentRefreshDriveToken();
            }
            return true;
        });
    }

    function signIn() {
        return initGoogleDriveClient(false).then(function (ready) {
            if (!ready) return false;
            return new Promise(function (resolve) {
                gisTokenClient.callback = function (tokenResponse) {
                    if (tokenResponse && tokenResponse.access_token) {
                        persistDriveToken(tokenResponse);
                        applyDriveAccessToken(tokenResponse.access_token);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                };
                try {
                    gisTokenClient.requestAccessToken({ prompt: 'consent' });
                } catch (e) {
                    resolve(false);
                }
            });
        });
    }

    function signOut() {
        localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
        driveAccessToken = null;
        if (global.gapi && global.gapi.client) {
            global.gapi.client.setToken(null);
        }
    }

    function isSignedIn() {
        return !!driveAccessToken && !!readPersistedDriveToken();
    }

    global.CPDrive = {
        DECK_FILE_EXTENSION: DECK_FILE_EXTENSION,
        hasDriveConfig: hasDriveConfig,
        onStatus: onStatus,
        initGoogleDriveClient: initGoogleDriveClient,
        ensureDriveTokenBeforeDriveOp: ensureDriveTokenBeforeDriveOp,
        tryRestoreSession: tryRestoreSession,
        signIn: signIn,
        signOut: signOut,
        isSignedIn: isSignedIn,
        getAccessToken: function () { return driveAccessToken; },
        listDeckFiles: listDeckFiles,
        saveDeckToDrive: saveDeckToDrive,
        fetchDriveFileMedia: fetchDriveFileMedia,
        deleteDriveFile: deleteDriveFile,
        applyDriveAccessToken: applyDriveAccessToken
    };
})(typeof window !== 'undefined' ? window : globalThis);
