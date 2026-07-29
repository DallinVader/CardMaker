/**
 * Type / Subtype option catalogs shared between Card Maker and Saved Projects.
 * Persists in localStorage; when signed in, cardmaker-field-options-drive.js syncs
 * the same data to Google Drive appDataFolder.
 */
(function (global) {
    var STORAGE_KEY = 'cardmaker_field_options_v1';
    var DRIVE_DOC_VERSION = 1;
    var KIND_TYPE = 'types';
    var KIND_SUBTYPE = 'subtypes';

    var DEFAULT_TYPES = [
        'Unit', 'Spell', 'Equipment', 'Holding', 'Wealth', 'Hero', 'Tactic', 'Commander'
    ];
    var DEFAULT_SUBTYPES = [
        'Army', 'Evocation', 'Divination', 'Necromancy', 'Enchantment', 'Transmutation',
        'Weapon', 'Armor', 'Economy', 'Ritual', 'Vehicle', 'Tool', 'Ship'
    ];

    var mutateListener = null;
    var driveNotifyDepth = 0;

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

    function normalizeName(name) {
        return String(name == null ? '' : name).trim();
    }

    function normalizeList(arr) {
        var out = [];
        var seen = Object.create(null);
        (arr || []).forEach(function (raw) {
            var n = normalizeName(raw);
            if (!n) return;
            var key = n.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            out.push(n);
        });
        return out;
    }

    function defaultDoc() {
        return {
            types: DEFAULT_TYPES.slice(),
            subtypes: DEFAULT_SUBTYPES.slice()
        };
    }

    function readDoc() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return defaultDoc();
            var j = JSON.parse(raw);
            if (!j || typeof j !== 'object') return defaultDoc();
            return {
                types: normalizeList(Array.isArray(j.types) ? j.types : DEFAULT_TYPES),
                subtypes: normalizeList(Array.isArray(j.subtypes) ? j.subtypes : DEFAULT_SUBTYPES)
            };
        } catch (e) {
            return defaultDoc();
        }
    }

    function writeDoc(doc) {
        var next = {
            types: normalizeList(doc && doc.types),
            subtypes: normalizeList(doc && doc.subtypes)
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (e) { /* ignore */ }
        notifyMutated();
        return next;
    }

    function getList(kind) {
        var doc = readDoc();
        if (kind === KIND_SUBTYPE || kind === 'subtype') return doc.subtypes.slice();
        return doc.types.slice();
    }

    function setList(kind, arr) {
        var doc = readDoc();
        if (kind === KIND_SUBTYPE || kind === 'subtype') {
            doc.subtypes = normalizeList(arr);
        } else {
            doc.types = normalizeList(arr);
        }
        writeDoc(doc);
        return getList(kind);
    }

    function getTypes() {
        return getList(KIND_TYPE);
    }

    function getSubtypes() {
        return getList(KIND_SUBTYPE);
    }

    function setTypes(arr) {
        return setList(KIND_TYPE, arr);
    }

    function setSubtypes(arr) {
        return setList(KIND_SUBTYPE, arr);
    }

    function findIndexCaseInsensitive(list, name) {
        var key = normalizeName(name).toLowerCase();
        if (!key) return -1;
        for (var i = 0; i < list.length; i++) {
            if (String(list[i]).toLowerCase() === key) return i;
        }
        return -1;
    }

    function add(kind, name) {
        var n = normalizeName(name);
        if (!n) return null;
        var list = getList(kind);
        if (findIndexCaseInsensitive(list, n) >= 0) return null;
        list.push(n);
        setList(kind, list);
        return n;
    }

    function rename(kind, from, to) {
        var fromN = normalizeName(from);
        var toN = normalizeName(to);
        if (!fromN || !toN) return null;
        var list = getList(kind);
        var ix = findIndexCaseInsensitive(list, fromN);
        if (ix < 0) return null;
        var other = findIndexCaseInsensitive(list, toN);
        if (other >= 0 && other !== ix) return null;
        list[ix] = toN;
        setList(kind, list);
        return toN;
    }

    function remove(kind, name) {
        var n = normalizeName(name);
        if (!n) return null;
        var list = getList(kind);
        var ix = findIndexCaseInsensitive(list, n);
        if (ix < 0) return null;
        var removed = list[ix];
        list.splice(ix, 1);
        setList(kind, list);
        return removed;
    }

    /** Union: remote order first, then local-only extras (case-insensitive). */
    function mergeStringLists(localArr, remoteArr) {
        var out = [];
        var seen = Object.create(null);
        function take(arr) {
            (arr || []).forEach(function (raw) {
                var n = normalizeName(raw);
                if (!n) return;
                var key = n.toLowerCase();
                if (seen[key]) return;
                seen[key] = true;
                out.push(n);
            });
        }
        take(remoteArr);
        take(localArr);
        return out;
    }

    function importFromDriveJson(jsonStr) {
        var doc;
        try {
            doc = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        } catch (e) {
            return;
        }
        if (!doc || typeof doc !== 'object') return;
        var local = readDoc();
        var remoteTypes = Array.isArray(doc.types) ? doc.types : [];
        var remoteSubtypes = Array.isArray(doc.subtypes) ? doc.subtypes : [];
        runWithDriveNotifySuppressed(function () {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    types: mergeStringLists(local.types, remoteTypes),
                    subtypes: mergeStringLists(local.subtypes, remoteSubtypes)
                }));
            } catch (e) { /* ignore */ }
        });
    }

    function exportDriveJson() {
        var doc = readDoc();
        return JSON.stringify({
            v: DRIVE_DOC_VERSION,
            types: doc.types,
            subtypes: doc.subtypes
        });
    }

    /**
     * @param {HTMLSelectElement} selectEl
     * @param {'types'|'subtypes'|'type'|'subtype'} kind
     * @param {boolean} includeEmpty
     * @param {string} [emptyLabel]
     * @param {string} [selected]
     */
    function fillSelect(selectEl, kind, includeEmpty, emptyLabel, selected) {
        if (!selectEl) return;
        var list = getList(kind);
        var want = selected != null ? String(selected) : String(selectEl.value || '');
        while (selectEl.firstChild) {
            selectEl.removeChild(selectEl.firstChild);
        }
        if (includeEmpty) {
            var o0 = document.createElement('option');
            o0.value = '';
            o0.textContent = emptyLabel != null ? emptyLabel : '—';
            selectEl.appendChild(o0);
        }
        list.forEach(function (name) {
            var o = document.createElement('option');
            o.value = name;
            o.textContent = name;
            selectEl.appendChild(o);
        });
        if (want) {
            var found = Array.from(selectEl.options).some(function (x) { return x.value === want; });
            if (!found) {
                var orphan = document.createElement('option');
                orphan.value = want;
                orphan.textContent = want;
                selectEl.appendChild(orphan);
            }
            selectEl.value = want;
        } else {
            selectEl.value = '';
        }
    }

    global.CardMakerFieldOptions = {
        STORAGE_KEY: STORAGE_KEY,
        DRIVE_DOC_VERSION: DRIVE_DOC_VERSION,
        KIND_TYPE: KIND_TYPE,
        KIND_SUBTYPE: KIND_SUBTYPE,
        DEFAULT_TYPES: DEFAULT_TYPES.slice(),
        DEFAULT_SUBTYPES: DEFAULT_SUBTYPES.slice(),
        getTypes: getTypes,
        getSubtypes: getSubtypes,
        setTypes: setTypes,
        setSubtypes: setSubtypes,
        getList: getList,
        setList: setList,
        add: add,
        rename: rename,
        remove: remove,
        fillSelect: fillSelect,
        setMutateListener: setMutateListener,
        runWithDriveNotifySuppressed: runWithDriveNotifySuppressed,
        importFromDriveJson: importFromDriveJson,
        exportDriveJson: exportDriveJson,
        mergeStringLists: mergeStringLists,
        normalizeName: normalizeName
    };
})(typeof window !== 'undefined' ? window : globalThis);
