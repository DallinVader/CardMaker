/**
 * Sync CardMakerSets registry to Google Drive appDataFolder (hidden).
 * Requires CardMakerSets + page-supplied auth (getToken, authHeaders, parseDriveError).
 */
(function (global) {
    var FILE_NAME = 'CardMaker.NamedSets.v1.json';
    var FILES_API = 'https://www.googleapis.com/drive/v3/files';
    var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
    var PUSH_DEBOUNCE_MS = 1400;

    var cfg = null;
    var pushTimer = null;
    var pushInFlight = null;

    function getCfg() {
        return cfg;
    }

    /**
     * @param {object} o
     * @param {function(): string|null} o.getToken
     * @param {function(Object=): Object} o.authHeaders  // extra headers optional
     * @param {function(string, number): string} o.parseDriveError
     * @param {function(): void} [o.onAfterPull]  // refresh dropdowns / UI
     */
    function init(o) {
        cfg = o || null;
    }

    async function findNamedSetsFileId() {
        var c = getCfg();
        if (!c || !c.getToken || !c.authHeaders || !c.parseDriveError) return null;
        var tok = c.getToken();
        if (!tok) return null;
        var u = new URL(FILES_API);
        u.searchParams.set('spaces', 'appDataFolder');
        u.searchParams.set('q', "name='" + FILE_NAME + "' and trashed=false");
        u.searchParams.set('fields', 'files(id,name)');
        u.searchParams.set('pageSize', '10');
        var res = await fetch(u.toString(), { headers: c.authHeaders() });
        var text = await res.text();
        if (!res.ok) throw new Error(c.parseDriveError(text, res.status));
        var data = JSON.parse(text);
        var files = data.files || [];
        return files.length && files[0].id ? files[0].id : null;
    }

    async function fetchNamedSetsFileMedia(fileId) {
        var c = getCfg();
        if (!c || !c.getToken || !c.authHeaders || !c.parseDriveError) return null;
        var tok = c.getToken();
        if (!tok) return null;
        var mediaUrl = FILES_API + '/' + encodeURIComponent(fileId) + '?alt=media';
        var res = await fetch(mediaUrl, { headers: c.authHeaders() });
        var text = await res.text();
        if (!res.ok) throw new Error(c.parseDriveError(text, res.status));
        return text;
    }

    async function driveCreateNamedSetsFile() {
        var c = getCfg();
        var tok = c.getToken();
        if (!tok) throw new Error('Not signed in.');
        var u = new URL(FILES_API);
        u.searchParams.set('fields', 'id,name');
        var res = await fetch(u.toString(), {
            method: 'POST',
            headers: c.authHeaders({ 'Content-Type': 'application/json; charset=UTF-8' }),
            body: JSON.stringify({
                name: FILE_NAME,
                mimeType: 'application/json',
                parents: ['appDataFolder']
            })
        });
        var text = await res.text();
        if (!res.ok) throw new Error(c.parseDriveError(text, res.status));
        return JSON.parse(text);
    }

    async function uploadNamedSetsMedia(fileId, jsonBody) {
        var c = getCfg();
        var u = new URL(UPLOAD_API + '/' + encodeURIComponent(fileId));
        u.searchParams.set('uploadType', 'media');
        var res = await fetch(u.toString(), {
            method: 'PATCH',
            headers: c.authHeaders({ 'Content-Type': 'application/json; charset=UTF-8' }),
            body: jsonBody
        });
        var text = await res.text();
        if (!res.ok) throw new Error(c.parseDriveError(text, res.status));
    }

    async function pushNow() {
        var CM = global.CardMakerSets;
        var c = getCfg();
        if (!CM || !c || !c.getToken || !c.authHeaders) return;
        var tok = c.getToken();
        if (!tok) return;
        var body = CM.exportNamedSetsDriveJson();
        var id = await findNamedSetsFileId();
        if (!id) {
            var created = await driveCreateNamedSetsFile();
            if (!created || !created.id) throw new Error('Drive create returned no file id.');
            id = created.id;
        }
        await uploadNamedSetsMedia(id, body);
    }

    function schedulePush() {
        var c = getCfg();
        if (!c || !c.getToken || !c.getToken()) return;
        if (pushTimer != null) {
            clearTimeout(pushTimer);
            pushTimer = null;
        }
        pushTimer = setTimeout(function () {
            pushTimer = null;
            if (pushInFlight) return;
            pushInFlight = pushNow()
                .catch(function (err) {
                    console.warn('Named sets Drive push failed:', err);
                })
                .then(function () {
                    pushInFlight = null;
                });
        }, PUSH_DEBOUNCE_MS);
    }

    async function pullMerge() {
        var CM = global.CardMakerSets;
        var c = getCfg();
        if (!CM || !c || !c.getToken || !c.authHeaders) return;
        var tok = c.getToken();
        if (!tok) return;
        try {
            var id = await findNamedSetsFileId();
            if (id) {
                var txt = await fetchNamedSetsFileMedia(id);
                if (txt && txt.trim()) {
                    CM.importNamedSetsFromDriveJson(txt);
                }
            }
            await pushNow();
            if (typeof c.onAfterPull === 'function') {
                try {
                    c.onAfterPull();
                } catch (e2) { /* ignore */ }
            }
        } catch (err) {
            console.warn('Named sets Drive pull/merge:', err);
        }
    }

    global.CardMakerSetsDrive = {
        FILE_NAME: FILE_NAME,
        init: init,
        pullMerge: pullMerge,
        pushNow: pushNow,
        schedulePush: schedulePush
    };
})(typeof window !== 'undefined' ? window : globalThis);
