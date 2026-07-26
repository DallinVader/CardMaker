/**
 * First-party cookie / local storage consent banner for Card Maker.
 * Does not control Google's third-party cookies — those are browser settings.
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'cardmaker_cookie_consent_v1';
    var BANNER_ID = 'cmCookieConsent';

    function readConsent() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (!data || data.accepted !== true) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    function writeConsent() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            accepted: true,
            at: new Date().toISOString()
        }));
    }

    function injectStyles() {
        if (document.getElementById('cmCookieConsentStyles')) return;
        var style = document.createElement('style');
        style.id = 'cmCookieConsentStyles';
        style.textContent = [
            '#' + BANNER_ID + '{',
            'position:fixed;left:16px;right:16px;bottom:16px;z-index:100000;',
            'max-width:520px;margin:0 auto;padding:16px 18px;',
            'border-radius:14px;border:1px solid rgba(148,163,184,0.35);',
            'background:rgba(15,23,42,0.96);color:#e2e8f0;',
            'box-shadow:0 12px 40px rgba(0,0,0,0.45);',
            'font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
            '}',
            '#' + BANNER_ID + ' h2{margin:0 0 8px;font-size:15px;font-weight:700;color:#f8fafc;}',
            '#' + BANNER_ID + ' p{margin:0 0 10px;color:#cbd5e1;}',
            '#' + BANNER_ID + ' .cm-cookie-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;}',
            '#' + BANNER_ID + ' button{',
            'appearance:none;border:0;border-radius:10px;padding:9px 14px;cursor:pointer;',
            'font:inherit;font-weight:650;',
            '}',
            '#' + BANNER_ID + ' .cm-cookie-accept{background:#38bdf8;color:#0f172a;}',
            '#' + BANNER_ID + ' .cm-cookie-accept:hover{filter:brightness(1.06);}',
            '#' + BANNER_ID + ' .cm-cookie-details{background:transparent;color:#94a3b8;text-decoration:underline;padding:9px 6px;}',
            '#' + BANNER_ID + ' .cm-cookie-more{display:none;margin-top:8px;padding-top:8px;',
            'border-top:1px solid rgba(148,163,184,0.25);font-size:12.5px;color:#94a3b8;}',
            '#' + BANNER_ID + '.is-expanded .cm-cookie-more{display:block;}',
            '@media (max-width:560px){#' + BANNER_ID + '{left:10px;right:10px;bottom:10px;}}'
        ].join('');
        document.head.appendChild(style);
    }

    function hideBanner() {
        var el = document.getElementById(BANNER_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function showBanner() {
        if (document.getElementById(BANNER_ID)) return;
        injectStyles();
        var el = document.createElement('div');
        el.id = BANNER_ID;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-label', 'Cookie consent');
        el.innerHTML =
            '<h2>Cookies &amp; local data</h2>' +
            '<p>Card Maker stores your Google Drive session and card drafts in this browser so you stay signed in and don’t lose work.</p>' +
            '<div class="cm-cookie-more">' +
            '<p>Accepting here only covers <strong>this site’s</strong> local storage. Google sign-in also uses Google’s own cookies, which you control in your browser settings (Chrome → Privacy → Cookies / Third-party sign-in).</p>' +
            '</div>' +
            '<div class="cm-cookie-actions">' +
            '<button type="button" class="cm-cookie-accept">Accept</button>' +
            '<button type="button" class="cm-cookie-details">More info</button>' +
            '</div>';
        document.body.appendChild(el);

        el.querySelector('.cm-cookie-accept').addEventListener('click', function () {
            writeConsent();
            hideBanner();
        });
        el.querySelector('.cm-cookie-details').addEventListener('click', function () {
            el.classList.toggle('is-expanded');
            this.textContent = el.classList.contains('is-expanded') ? 'Less info' : 'More info';
        });
    }

    function maybeShow() {
        if (readConsent()) return;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', maybeShow);
            return;
        }
        showBanner();
    }

    global.CardMakerCookieConsent = {
        STORAGE_KEY: STORAGE_KEY,
        hasAccepted: function () { return !!readConsent(); },
        accept: function () { writeConsent(); hideBanner(); },
        show: showBanner,
        maybeShow: maybeShow
    };

    maybeShow();
})(typeof window !== 'undefined' ? window : this);
