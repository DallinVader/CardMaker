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

    /** Saved Projects / Deck Builder — same layout size as the editor live canvas. */
    var EDITOR_PREVIEW_OPTS = {
        maxOutputSide: 1750,
        outputMime: 'image/jpeg',
        outputQuality: 0.9
    };
    var EDITOR_PREVIEW_VARIANT = 'e1750';

    /** Saved Projects grid — a bit sharper than library/player thumbs. */
    var GRID_THUMB_RENDER_OPTS = {
        maxOutputSide: 640,
        outputMime: 'image/jpeg',
        outputQuality: 0.86
    };
    var GRID_THUMB_VARIANT = 'g640';

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

    /** All cached card projects (skips editor draft). */
    function readAllSaveCache() {
        return openIdb().then(function (db) {
            if (!db) return [];
            return new Promise(function (resolve, reject) {
                var out = [];
                try {
                    var tx = db.transaction(IDB_STORE_SAVES, 'readonly');
                    var req = tx.objectStore(IDB_STORE_SAVES).openCursor();
                    req.onsuccess = function (e) {
                        var cur = e.target.result;
                        if (!cur) {
                            resolve(out);
                            return;
                        }
                        var key = String(cur.key);
                        if (key.indexOf('__cardmaker_') === 0) {
                            cur.continue();
                            return;
                        }
                        var rec = cur.value;
                        if (rec && rec.state && typeof rec.state === 'object' && rec.state.kind !== 'cardmaker-deck') {
                            out.push({
                                id: key,
                                state: rec.state,
                                modifiedTime: rec.modifiedTime != null ? String(rec.modifiedTime) : null,
                                size: rec.size != null ? String(rec.size) : null
                            });
                        }
                        cur.continue();
                    };
                    req.onerror = function () { reject(req.error); };
                } catch (err) {
                    reject(err);
                }
            });
        }).catch(function () { return []; });
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

    function thumbCacheKey(fileId, modifiedTime, variant) {
        var k = String(fileId || '') + '|' + String(modifiedTime || '') + '|elive';
        if (variant) k += '|' + String(variant);
        return k;
    }

    function readThumbCache(fileId, modifiedTime, variant) {
        return idbGet(IDB_STORE_THUMBS, thumbCacheKey(fileId, modifiedTime, variant));
    }

    function writeThumbCache(fileId, modifiedTime, dataUrl, variant) {
        if (!fileId || !dataUrl) return Promise.resolve();
        return idbPut(IDB_STORE_THUMBS, thumbCacheKey(fileId, modifiedTime, variant), {
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

    function clipAppProp(value, maxLen) {
        var s = value == null ? '' : String(value).trim();
        if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
        return s;
    }

    /** Drive appProperties (strings only) for list/filter without downloading media. */
    function buildAppPropertiesFromState(state) {
        var fields = state && state.fields ? state.fields : {};
        var setId = clipAppProp(fields.CardMakerSetId, 64);
        var title = clipAppProp(fields.Title, 80);
        var rarity = clipAppProp(fields.Rarity, 32);
        var type = clipAppProp(fields.Type, 48);
        var subtype = clipAppProp(fields.Subtype, 48);
        var n = parseInt(fields.CardSetNumber, 10);
        var t = parseInt(fields.CardSetTotal, 10);
        var cost = clipAppProp(fields.TreasureCost, 16);
        var props = {
            cmSetId: setId || '',
            cmTitle: title || '',
            cmRarity: rarity || '',
            cmType: type || '',
            cmSubtype: subtype || ''
        };
        if (n >= 1) props.cmSetN = String(n);
        if (t >= 1) props.cmSetT = String(t);
        if (cost) props.cmCost = cost;
        return props;
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

    function sourceLooksAlphaCapable(src, hintMime) {
        var mime = String(hintMime || '').toLowerCase();
        if (mime.indexOf('png') !== -1 || mime.indexOf('webp') !== -1 || mime.indexOf('gif') !== -1) return true;
        if (typeof src === 'string') {
            var head = src.slice(0, 32).toLowerCase();
            if (head.indexOf('image/png') !== -1 || head.indexOf('image/webp') !== -1 || head.indexOf('image/gif') !== -1) {
                return true;
            }
        }
        return false;
    }

    /** JPEG has no alpha — encoding a PNG onto JPEG fills transparent pixels with black. */
    function canvasHasTransparency(cx, w, h) {
        try {
            var data = cx.getImageData(0, 0, w, h).data;
            var i;
            for (i = 3; i < data.length; i += 4) {
                if (data[i] < 255) return true;
            }
            return false;
        } catch (e) {
            return null;
        }
    }

    /**
     * Downscale / recompress a data URL or File for embedding in project JSON.
     * Skips non-data relative paths (e.g. CardFrame.png).
     * Opaque images become JPEG; images with transparency stay PNG.
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

            var hintMime = (typeof Blob !== 'undefined' && src instanceof Blob) ? (src.type || '') : '';

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
                        var cx = c.getContext('2d', { alpha: true });
                        if (!cx) {
                            resolve(typeof src === 'string' ? src : url);
                            return;
                        }
                        cx.clearRect(0, 0, outW, outH);
                        cx.drawImage(img, 0, 0, outW, outH);
                        var hasAlpha = canvasHasTransparency(cx, outW, outH);
                        var keepAlpha = hasAlpha === true ||
                            (hasAlpha == null && sourceLooksAlphaCapable(url, hintMime));
                        var out = keepAlpha
                            ? c.toDataURL('image/png')
                            : c.toDataURL('image/jpeg', quality);
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
        EDITOR_PREVIEW_OPTS: EDITOR_PREVIEW_OPTS,
        EDITOR_PREVIEW_VARIANT: EDITOR_PREVIEW_VARIANT,
        GRID_THUMB_RENDER_OPTS: GRID_THUMB_RENDER_OPTS,
        GRID_THUMB_VARIANT: GRID_THUMB_VARIANT,
        PRINT_RENDER_OPTS: PRINT_RENDER_OPTS,
        PROJECT_EXT: PROJECT_EXT,
        EDITOR_DRAFT_KEY: EDITOR_DRAFT_KEY,
        ART_EMBED_MAX_SIDE: ART_EMBED_MAX_SIDE,
        openIdb: openIdb,
        driveFileMetaUnchanged: driveFileMetaUnchanged,
        isCardmakerProjectFileName: isCardmakerProjectFileName,
        readSaveCache: readSaveCache,
        readAllSaveCache: readAllSaveCache,
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
