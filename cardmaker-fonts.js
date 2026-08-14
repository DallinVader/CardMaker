/**
 * Card Maker font catalog: built-in families, uploaded files (IndexedDB),
 * and a default family for new cards. Drive sync lives in cardmaker-fonts-drive.js.
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'cardmaker_fonts_meta_v1';
    var IDB_NAME = 'cardmaker-fonts';
    var IDB_STORE = 'byId';
    var IDB_VERSION = 1;
    var DRIVE_DOC_VERSION = 1;
    var MAX_FONT_BYTES = 2500000;

    var BUILTIN = [
        { family: 'Medieval', builtin: true },
        { family: 'Georgia', builtin: true },
        { family: 'Times New Roman', builtin: true },
        { family: 'Palatino Linotype', builtin: true },
    ];

    var mutateListener = null;
    var driveNotifyDepth = 0;
    var loadedFaces = Object.create(null);
    var idbOpenPromise = null;

    function setMutateListener(fn) {
        mutateListener = typeof fn === 'function' ? fn : null;
    }

    function runWithDriveNotifySuppressed(fn) {
        driveNotifyDepth++;
        try {
            return fn();
        } finally {
            driveNotifyDepth--;
        }
    }

    function notifyMutated() {
        if (driveNotifyDepth > 0) return;
        if (!mutateListener) return;
        try {
            mutateListener();
        } catch (e) { /* ignore */ }
    }

    function defaultMeta() {
        return { defaultFamily: 'Medieval', customs: [] };
    }

    function normalizeFamily(name) {
        return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    }

    function quoteCssFamily(family) {
        var f = normalizeFamily(family) || 'Medieval';
        if (/^[A-Za-z][-A-Za-z0-9]*$/.test(f)) return f;
        return '"' + f.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    function cssStack(family) {
        var f = normalizeFamily(family) || 'Medieval';
        if (f.toLowerCase() === 'medieval') return 'Medieval, serif';
        return quoteCssFamily(f) + ', Medieval, serif';
    }

    function readMeta() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultMeta();
            var j = JSON.parse(raw);
            if (!j || typeof j !== 'object') return defaultMeta();
            var customs = Array.isArray(j.customs) ? j.customs : [];
            var out = [];
            var seen = Object.create(null);
            customs.forEach(function (c) {
                if (!c || !c.id) return;
                var fam = normalizeFamily(c.family);
                if (!fam) return;
                var id = String(c.id);
                if (seen[id]) return;
                seen[id] = true;
                out.push({
                    id: id,
                    family: fam,
                    mime: c.mime ? String(c.mime) : 'font/ttf'
                });
            });
            var def = normalizeFamily(j.defaultFamily) || 'Medieval';
            return { defaultFamily: def, customs: out };
        } catch (e) {
            return defaultMeta();
        }
    }

    function writeMeta(meta) {
        var next = {
            defaultFamily: normalizeFamily(meta && meta.defaultFamily) || 'Medieval',
            customs: (meta && meta.customs) || []
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (e) { /* ignore */ }
        notifyMutated();
        return next;
    }

    function openIdb() {
        if (idbOpenPromise) return idbOpenPromise;
        idbOpenPromise = new Promise(function (resolve) {
            if (!global.indexedDB) {
                resolve(null);
                return;
            }
            var req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onerror = function () {
                resolve(null);
            };
            req.onsuccess = function () {
                resolve(req.result);
            };
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
        });
        return idbOpenPromise;
    }

    function idbPut(rec) {
        return openIdb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
                tx.objectStore(IDB_STORE).put(rec, rec.id);
            });
        });
    }

    function idbGet(id) {
        return openIdb().then(function (db) {
            if (!db) return null;
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readonly');
                var req = tx.objectStore(IDB_STORE).get(String(id));
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function idbDelete(id) {
        return openIdb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
                tx.objectStore(IDB_STORE).delete(String(id));
            });
        });
    }

    function getDefaultFamily() {
        return readMeta().defaultFamily || 'Medieval';
    }

    function setDefaultFamily(family) {
        var meta = readMeta();
        meta.defaultFamily = normalizeFamily(family) || 'Medieval';
        writeMeta(meta);
        return meta.defaultFamily;
    }

    function getCatalog() {
        var meta = readMeta();
        var list = BUILTIN.map(function (b) {
            return { family: b.family, builtin: true, id: null };
        });
        meta.customs.forEach(function (c) {
            list.push({ family: c.family, builtin: false, id: c.id, mime: c.mime });
        });
        return list;
    }

    function familyExists(family) {
        var want = normalizeFamily(family).toLowerCase();
        return getCatalog().some(function (c) {
            return c.family.toLowerCase() === want;
        });
    }

    function mimeFromFile(file) {
        var t = (file && file.type) ? String(file.type).toLowerCase() : '';
        if (t.indexOf('woff2') !== -1) return 'font/woff2';
        if (t.indexOf('woff') !== -1) return 'font/woff';
        if (t.indexOf('otf') !== -1 || t.indexOf('opentype') !== -1) return 'font/otf';
        var name = file && file.name ? String(file.name).toLowerCase() : '';
        if (name.endsWith('.woff2')) return 'font/woff2';
        if (name.endsWith('.woff')) return 'font/woff';
        if (name.endsWith('.otf')) return 'font/otf';
        return 'font/ttf';
    }

    function familyFromFileName(name) {
        var base = String(name || '').replace(/\.[^.]+$/, '');
        base = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        return normalizeFamily(base) || 'CustomFont';
    }

    function newFontId() {
        return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(String(fr.result || '')); };
            fr.onerror = function () { reject(fr.error || new Error('Read failed')); };
            fr.readAsDataURL(file);
        });
    }

    function addUploadedFont(file, familyOverride) {
        if (!file) return Promise.reject(new Error('No file selected.'));
        if (file.size > MAX_FONT_BYTES) {
            return Promise.reject(new Error('Font is larger than 2.5 MB.'));
        }
        var fam = normalizeFamily(familyOverride) || familyFromFileName(file.name);
        if (!fam) return Promise.reject(new Error('Enter a font name.'));
        var mime = mimeFromFile(file);
        var id = newFontId();
        return fileToDataUrl(file).then(function (dataUrl) {
            if (!dataUrl || dataUrl.indexOf('data:') !== 0) {
                throw new Error('Could not read font file.');
            }
            var rec = { id: id, family: fam, mime: mime, dataUrl: dataUrl };
            return idbPut(rec).then(function () {
                var meta = readMeta();
                meta.customs.push({ id: id, family: fam, mime: mime });
                writeMeta(meta);
                return rec;
            });
        });
    }

    function removeUploadedFont(id) {
        var sid = String(id || '');
        if (!sid) return Promise.resolve(false);
        var meta = readMeta();
        var next = meta.customs.filter(function (c) { return c.id !== sid; });
        if (next.length === meta.customs.length) return Promise.resolve(false);
        meta.customs = next;
        if (loadedFaces[sid]) {
            try {
                document.fonts.delete(loadedFaces[sid]);
            } catch (e) { /* ignore */ }
            delete loadedFaces[sid];
        }
        writeMeta(meta);
        return idbDelete(sid).then(function () { return true; });
    }

    function ensureLoaded(family) {
        var fam = normalizeFamily(family) || 'Medieval';
        if (fam.toLowerCase() === 'medieval') {
            try {
                return document.fonts.load('200px Medieval').catch(function () { return null; });
            } catch (e) {
                return Promise.resolve(null);
            }
        }
        var custom = readMeta().customs.filter(function (c) {
            return c.family.toLowerCase() === fam.toLowerCase();
        })[0];
        if (!custom) {
            try {
                return document.fonts.load('80px ' + quoteCssFamily(fam)).catch(function () { return null; });
            } catch (e2) {
                return Promise.resolve(null);
            }
        }
        if (loadedFaces[custom.id]) {
            return Promise.resolve(loadedFaces[custom.id]);
        }
        return idbGet(custom.id).then(function (rec) {
            if (!rec || !rec.dataUrl || typeof FontFace === 'undefined') return null;
            var face = new FontFace(custom.family, 'url(' + rec.dataUrl + ')');
            return face.load().then(function (loaded) {
                document.fonts.add(loaded);
                loadedFaces[custom.id] = loaded;
                return loaded;
            });
        }).catch(function () {
            return null;
        });
    }

    function ensureAllUploadedLoaded() {
        var customs = readMeta().customs;
        if (!customs.length) return Promise.resolve();
        return Promise.all(customs.map(function (c) {
            return ensureLoaded(c.family);
        }));
    }

    function fillSelect(selectEl, selected) {
        if (!selectEl) return;
        var want = selected != null && String(selected).trim()
            ? normalizeFamily(selected)
            : getDefaultFamily();
        while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
        getCatalog().forEach(function (item) {
            var o = document.createElement('option');
            o.value = item.family;
            o.textContent = item.builtin ? item.family : (item.family + ' (uploaded)');
            selectEl.appendChild(o);
        });
        var found = Array.prototype.some.call(selectEl.options, function (x) {
            return x.value === want;
        });
        if (!found && want) {
            var orphan = document.createElement('option');
            orphan.value = want;
            orphan.textContent = want + ' (not in library)';
            selectEl.appendChild(orphan);
        }
        selectEl.value = want;
    }

    function exportDriveDoc() {
        var meta = readMeta();
        return Promise.all(meta.customs.map(function (c) {
            return idbGet(c.id).then(function (rec) {
                return {
                    id: c.id,
                    family: c.family,
                    mime: c.mime,
                    dataUrl: rec && rec.dataUrl ? rec.dataUrl : ''
                };
            });
        })).then(function (fonts) {
            return JSON.stringify({
                version: DRIVE_DOC_VERSION,
                kind: 'cardmaker-fonts',
                defaultFamily: meta.defaultFamily,
                fonts: fonts.filter(function (f) { return f && f.dataUrl; }),
                updatedAt: new Date().toISOString()
            });
        });
    }

    function importFromDriveDoc(parsed) {
        if (!parsed || typeof parsed !== 'object') return Promise.resolve();
        var fonts = Array.isArray(parsed.fonts) ? parsed.fonts : [];
        var writes = fonts.filter(function (f) {
            return f && f.id && f.family && f.dataUrl;
        }).map(function (f) {
            return idbPut({
                id: String(f.id),
                family: normalizeFamily(f.family),
                mime: f.mime ? String(f.mime) : 'font/ttf',
                dataUrl: String(f.dataUrl)
            });
        });
        return Promise.all(writes).then(function () {
            runWithDriveNotifySuppressed(function () {
                var meta = readMeta();
                var byId = Object.create(null);
                meta.customs.forEach(function (c) {
                    if (c && c.id) byId[c.id] = c;
                });
                fonts.forEach(function (f) {
                    if (!f || !f.id || !f.family || !f.dataUrl) return;
                    byId[String(f.id)] = {
                        id: String(f.id),
                        family: normalizeFamily(f.family),
                        mime: f.mime ? String(f.mime) : 'font/ttf'
                    };
                });
                var merged = [];
                Object.keys(byId).forEach(function (k) { merged.push(byId[k]); });
                writeMeta({
                    defaultFamily: normalizeFamily(parsed.defaultFamily) || meta.defaultFamily || 'Medieval',
                    customs: merged
                });
            });
        });
    }

    function importFromDriveJson(text) {
        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return Promise.resolve();
        }
        if (!parsed || parsed.kind !== 'cardmaker-fonts') return Promise.resolve();
        return importFromDriveDoc(parsed);
    }

    global.CardMakerFonts = {
        STORAGE_KEY: STORAGE_KEY,
        DRIVE_DOC_VERSION: DRIVE_DOC_VERSION,
        BUILTIN: BUILTIN.slice(),
        MAX_FONT_BYTES: MAX_FONT_BYTES,
        normalizeFamily: normalizeFamily,
        cssStack: cssStack,
        quoteCssFamily: quoteCssFamily,
        getDefaultFamily: getDefaultFamily,
        setDefaultFamily: setDefaultFamily,
        getCatalog: getCatalog,
        familyExists: familyExists,
        addUploadedFont: addUploadedFont,
        removeUploadedFont: removeUploadedFont,
        ensureLoaded: ensureLoaded,
        ensureAllUploadedLoaded: ensureAllUploadedLoaded,
        fillSelect: fillSelect,
        familyFromFileName: familyFromFileName,
        exportDriveDoc: exportDriveDoc,
        importFromDriveJson: importFromDriveJson,
        setMutateListener: setMutateListener,
        runWithDriveNotifySuppressed: runWithDriveNotifySuppressed
    };
})(typeof window !== 'undefined' ? window : this);
