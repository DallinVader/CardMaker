/**
 * Shared CardMaker performance helpers: IndexedDB save/thumb cache,
 * preview render options, art compression, Drive appProperties helpers.
 */
(function (global) {
    'use strict';

    var IDB_NAME = 'cardmaker-spm-saves';
    var IDB_STORE_SAVES = 'byFileId';
    var IDB_STORE_THUMBS = 'thumbByKey';
    var IDB_VERSION = 2;
    var PROJECT_EXT = '.cardmaker.json';
    var EDITOR_DRAFT_KEY = '__cardmaker_editor_draft__';

    /** Same opts as Card Player deck thumbs — fast UI previews. */
    var THUMB_RENDER_OPTS = {
        maxOutputSide: 400,
        outputMime: 'image/jpeg',
        outputQuality: 0.78
    };

    /** Print grid / PDF faces — sharp enough at poker size, much faster than full 2500×3500 PNG. */
    var PRINT_RENDER_OPTS = {
        maxOutputSide: 1400,
        outputMime: 'image/jpeg',
        outputQuality: 0.9
    };

    /** Max longest side for embedded art/frame when saving (keeps Drive JSON smaller). */
    var ART_EMBED_MAX_SIDE = 1600;
    var ART_EMBED_JPEG_QUALITY = 0.82;

    var idbOpenPromise = null;

    function openIdb() {
        if (idbOpenPromise) return idbOpenPromise;
        idbOpenPromise = new Promise(function (resolve) {
            if (!global.indexedDB) {
                resolve(null);
                return;
            }
            var req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onerror = function () {
                console.warn('CardMakerPerf IndexedDB open error', req.error);
                resolve(null);
            };
            req.onsuccess = function () {
                resolve(req.result);
            };
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE_SAVES)) {
                    db.createObjectStore(IDB_STORE_SAVES);
                }
                if (!db.objectStoreNames.contains(IDB_STORE_THUMBS)) {
                    db.createObjectStore(IDB_STORE_THUMBS);
                }
            };
        });
        return idbOpenPromise;
    }

    function driveFileMetaUnchanged(prevFile, nextFile) {
        if (!prevFile || !nextFile) return false;
        if (!prevFile.modifiedTime || !nextFile.modifiedTime) return false;
        if (prevFile.modifiedTime !== nextFile.modifiedTime) return false;
        if (nextFile.size == null || prevFile.size == null) return true;
        return String(prevFile.size) === String(nextFile.size);
    }

    function isCardmakerProjectFileName(name) {
        if (!name) return false;
        var n = String(name).toLowerCase();
        return n.endsWith(PROJECT_EXT);
    }

    function idbGet(storeName, key) {
        return openIdb().then(function (db) {
            if (!db) return null;
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(storeName, 'readonly');
                    var r = tx.objectStore(storeName).get(key);
                    r.onsuccess = function () { resolve(r.result || null); };
                    r.onerror = function () { reject(r.error); };
                } catch (e) {
                    resolve(null);
                }
            }).catch(function (e) {
                console.warn('CardMakerPerf idbGet', e);
                return null;
            });
        });
    }

    function idbPut(storeName, key, value) {
        return openIdb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(storeName, 'readwrite');
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { reject(tx.error); };
                    tx.objectStore(storeName).put(value, key);
                } catch (e) {
                    console.warn('CardMakerPerf idbPut', e);
                    resolve();
                }
            }).catch(function (e) {
                console.warn('CardMakerPerf idbPut', e);
            });
        });
    }

    function idbDelete(storeName, key) {
        return openIdb().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(storeName, 'readwrite');
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { reject(tx.error); };
                    tx.objectStore(storeName).delete(key);
                } catch (e) {
                    resolve();
                }
            }).catch(function () { /* ignore */ });
        });
    }

    function readSaveCache(fileId) {
        return idbGet(IDB_STORE_SAVES, fileId);
    }

    function writeSaveCache(fileId, fileMeta, state) {
        if (!fileId || !fileMeta) return Promise.resolve();
        return idbPut(IDB_STORE_SAVES, fileId, {
            modifiedTime: fileMeta.modifiedTime,
            size: fileMeta.size,
            state: state
        });
    }

    function pruneSaveCache(keepIds) {
        return openIdb().then(function (db) {
            if (!db || !keepIds) return;
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(IDB_STORE_SAVES, 'readwrite');
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { reject(tx.error); };
                    var store = tx.objectStore(IDB_STORE_SAVES);
                    var req = store.openCursor();
                    req.onsuccess = function (e) {
                        var cur = e.target.result;
                        if (!cur) return;
                        if (!keepIds.has(cur.key)) store.delete(cur.key);
                        cur.continue();
                    };
                } catch (e) {
                    console.warn('CardMakerPerf pruneSaveCache', e);
                    resolve();
                }
            }).catch(function (e) {
                console.warn('CardMakerPerf pruneSaveCache', e);
            });
        });
    }

    function thumbCacheKey(fileId, modifiedTime) {
        return String(fileId || '') + '|' + String(modifiedTime || '');
    }

    function readThumbCache(fileId, modifiedTime) {
        return idbGet(IDB_STORE_THUMBS, thumbCacheKey(fileId, modifiedTime));
    }

    function writeThumbCache(fileId, modifiedTime, dataUrl) {
        if (!fileId || !dataUrl) return Promise.resolve();
        return idbPut(IDB_STORE_THUMBS, thumbCacheKey(fileId, modifiedTime), {
            dataUrl: dataUrl,
            modifiedTime: modifiedTime,
            cachedAt: Date.now()
        });
    }

    function readEditorDraft() {
        return idbGet(IDB_STORE_SAVES, EDITOR_DRAFT_KEY);
    }

    function writeEditorDraft(payload) {
        return idbPut(IDB_STORE_SAVES, EDITOR_DRAFT_KEY, payload);
    }

    function clearEditorDraft() {
        return idbDelete(IDB_STORE_SAVES, EDITOR_DRAFT_KEY);
    }

    /** Drive appProperties (strings only) for list/filter without downloading media. */
    function buildAppPropertiesFromState(state) {
        var fields = state && state.fields ? state.fields : {};
        var setId = fields.CardMakerSetId != null ? String(fields.CardMakerSetId).trim() : '';
        var title = fields.Title != null ? String(fields.Title).trim() : '';
        var rarity = fields.Rarity != null ? String(fields.Rarity).trim() : '';
        if (title.length > 80) title = title.slice(0, 80);
        if (setId.length > 64) setId = setId.slice(0, 64);
        if (rarity.length > 32) rarity = rarity.slice(0, 32);
        return {
            cmSetId: setId || '',
            cmTitle: title || '',
            cmRarity: rarity || ''
        };
    }

    function setIdFromDriveFile(file) {
        if (!file) return '';
        if (file.cardMakerSetId != null && String(file.cardMakerSetId).trim()) {
            return String(file.cardMakerSetId).trim();
        }
        var ap = file.appProperties;
        if (ap && ap.cmSetId != null) return String(ap.cmSetId).trim();
        return '';
    }

    function applyAppPropertiesToFileMeta(file) {
        if (!file) return file;
        file.cardMakerSetId = setIdFromDriveFile(file);
        return file;
    }

    /**
     * Downscale / recompress a data URL or File for embedding in project JSON.
     * Skips non-data relative paths (e.g. CardFrame.png).
     */
    function compressImageToDataUrl(src, maxSide, quality) {
        maxSide = maxSide || ART_EMBED_MAX_SIDE;
        quality = quality != null ? quality : ART_EMBED_JPEG_QUALITY;
        return new Promise(function (resolve) {
            if (!src) {
                resolve('');
                return;
            }
            if (typeof src === 'string' && !/^data:/i.test(src) && !/^blob:/i.test(src)) {
                resolve(src);
                return;
            }

            function fromObjectUrlOrData(url) {
                var img = new Image();
                img.onload = function () {
                    try {
                        var w = img.naturalWidth || img.width;
                        var h = img.naturalHeight || img.height;
                        if (!(w > 0 && h > 0)) {
                            resolve(typeof src === 'string' ? src : url);
                            return;
                        }
                        var scale = 1;
                        var longest = Math.max(w, h);
                        if (longest > maxSide) scale = maxSide / longest;
                        var outW = Math.max(1, Math.round(w * scale));
                        var outH = Math.max(1, Math.round(h * scale));
                        var c = document.createElement('canvas');
                        c.width = outW;
                        c.height = outH;
                        var cx = c.getContext('2d');
                        cx.drawImage(img, 0, 0, outW, outH);
                        var out = c.toDataURL('image/jpeg', quality);
                        resolve(out);
                    } catch (e) {
                        console.warn('CardMakerPerf compress', e);
                        resolve(typeof src === 'string' ? src : url);
                    }
                };
                img.onerror = function () {
                    resolve(typeof src === 'string' ? src : '');
                };
                img.src = url;
            }

            if (typeof Blob !== 'undefined' && src instanceof Blob) {
                var fr = new FileReader();
                fr.onload = function () {
                    fromObjectUrlOrData(fr.result);
                };
                fr.onerror = function () { resolve(''); };
                fr.readAsDataURL(src);
                return;
            }
            fromObjectUrlOrData(String(src));
        });
    }

    /**
     * Compress images.cardBaseSrc / images.artSrc on a project state (mutates copy).
     */
    function compressProjectStateImages(state) {
        if (!state || typeof state !== 'object') return Promise.resolve(state);
        var images = state.images || {};
        var next = {
            version: state.version,
            updatedAt: state.updatedAt,
            fields: state.fields,
            images: {
                cardBaseSrc: images.cardBaseSrc || '',
                artSrc: images.artSrc || ''
            }
        };
        return Promise.all([
            compressImageToDataUrl(next.images.cardBaseSrc),
            compressImageToDataUrl(next.images.artSrc)
        ]).then(function (pair) {
            next.images.cardBaseSrc = pair[0];
            next.images.artSrc = pair[1];
            return next;
        });
    }

    global.CardMakerPerf = {
        THUMB_RENDER_OPTS: THUMB_RENDER_OPTS,
        PRINT_RENDER_OPTS: PRINT_RENDER_OPTS,
        PROJECT_EXT: PROJECT_EXT,
        EDITOR_DRAFT_KEY: EDITOR_DRAFT_KEY,
        ART_EMBED_MAX_SIDE: ART_EMBED_MAX_SIDE,
        openIdb: openIdb,
        driveFileMetaUnchanged: driveFileMetaUnchanged,
        isCardmakerProjectFileName: isCardmakerProjectFileName,
        readSaveCache: readSaveCache,
        writeSaveCache: writeSaveCache,
        pruneSaveCache: pruneSaveCache,
        readThumbCache: readThumbCache,
        writeThumbCache: writeThumbCache,
        thumbCacheKey: thumbCacheKey,
        readEditorDraft: readEditorDraft,
        writeEditorDraft: writeEditorDraft,
        clearEditorDraft: clearEditorDraft,
        buildAppPropertiesFromState: buildAppPropertiesFromState,
        setIdFromDriveFile: setIdFromDriveFile,
        applyAppPropertiesToFileMeta: applyAppPropertiesToFileMeta,
        compressImageToDataUrl: compressImageToDataUrl,
        compressProjectStateImages: compressProjectStateImages
    };
})(typeof window !== 'undefined' ? window : this);
