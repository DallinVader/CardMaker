/**
 * Named card sets (name + total count) shared between Card Maker and Saved Projects.
 * Persists in localStorage only; each Drive save can store fields.CardMakerSetId.
 */
(function (global) {
    var NAMED_SETS_KEY = 'cardmaker_named_sets_v1';
    var ACTIVE_SET_KEY = 'cardmaker_active_set_v1';

    function readNamedSets() {
        try {
            var raw = localStorage.getItem(NAMED_SETS_KEY);
            if (!raw) return [];
            var j = JSON.parse(raw);
            if (!Array.isArray(j)) return [];
            return j.filter(function (x) {
                return x && typeof x.id === 'string' && typeof x.name === 'string';
            });
        } catch (e) {
            return [];
        }
    }

    function writeNamedSets(arr) {
        try {
            localStorage.setItem(NAMED_SETS_KEY, JSON.stringify(arr || []));
        } catch (e) { /* ignore */ }
    }

    function genSetId() {
        return 'cmset_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    function normalizeTotal(total) {
        var t = typeof total === 'number' ? total : parseInt(String(total), 10);
        return t >= 1 ? t : NaN;
    }

    function addNamedSet(name, total) {
        var n = String(name || '').trim();
        var t = normalizeTotal(total);
        if (!n || !isFinite(t)) return null;
        var sets = readNamedSets();
        var id = genSetId();
        sets.push({ id: id, name: n, total: t });
        writeNamedSets(sets);
        return sets[sets.length - 1];
    }

    function getNamedSetById(id) {
        if (!id) return null;
        var s = String(id);
        var sets = readNamedSets();
        for (var i = 0; i < sets.length; i++) {
            if (sets[i].id === s) return sets[i];
        }
        return null;
    }

    function updateNamedSet(id, name, total) {
        var nid = String(id || '').trim();
        if (!nid) return null;
        var n = String(name || '').trim();
        var t = normalizeTotal(total);
        if (!n || !isFinite(t)) return null;
        var sets = readNamedSets();
        var ix = -1;
        for (var i = 0; i < sets.length; i++) {
            if (sets[i].id === nid) {
                ix = i;
                break;
            }
        }
        if (ix < 0) return null;
        sets[ix] = { id: nid, name: n, total: t };
        writeNamedSets(sets);
        return sets[ix];
    }

    function getActiveSetId() {
        try {
            return localStorage.getItem(ACTIVE_SET_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function setActiveSetId(id) {
        try {
            if (id) {
                localStorage.setItem(ACTIVE_SET_KEY, String(id));
            } else {
                localStorage.removeItem(ACTIVE_SET_KEY);
            }
        } catch (e) { /* ignore */ }
    }

    function getDefaultCardSetTotal() {
        var s = getNamedSetById(getActiveSetId());
        if (s && normalizeTotal(s.total)) return normalizeTotal(s.total);
        return 120;
    }

    function fillSelect(selectEl, includeEmptyLabel, emptyLabel, activeId) {
        if (!selectEl) return;
        while (selectEl.firstChild) {
            selectEl.removeChild(selectEl.firstChild);
        }
        if (includeEmptyLabel) {
            var o0 = document.createElement('option');
            o0.value = '';
            o0.textContent = emptyLabel || '—';
            selectEl.appendChild(o0);
        }
        readNamedSets().forEach(function (s) {
            var o = document.createElement('option');
            o.value = s.id;
            o.textContent = String(s.name) + ' (' + s.total + ')';
            selectEl.appendChild(o);
        });
        var want = activeId != null ? String(activeId) : '';
        var found = Array.from(selectEl.options).some(function (x) { return x.value === want; });
        selectEl.value = found ? want : '';
    }

    global.CardMakerSets = {
        NAMED_SETS_KEY: NAMED_SETS_KEY,
        ACTIVE_SET_KEY: ACTIVE_SET_KEY,
        readNamedSets: readNamedSets,
        writeNamedSets: writeNamedSets,
        genSetId: genSetId,
        addNamedSet: addNamedSet,
        updateNamedSet: updateNamedSet,
        getNamedSetById: getNamedSetById,
        getActiveSetId: getActiveSetId,
        setActiveSetId: setActiveSetId,
        getDefaultCardSetTotal: getDefaultCardSetTotal,
        normalizeTotal: normalizeTotal,
        fillSelect: fillSelect
    };
})(typeof window !== 'undefined' ? window : globalThis);
