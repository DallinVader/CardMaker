/**
 * Renders a Card Maker project JSON (same shape as buildProjectState in index.html)
 * to a PNG data URL, matching the main editor canvas (2500×3500).
 */
(function () {
    var CANVAS_W = 2500;
    var CANVAS_H = 3500;
    /** Same as index.html LIVE_CANVAS_SCALE — previews layout at this size so wrap/text match the editor. */
    var EDITOR_LIVE_SCALE = 0.5;

    function cardFontFamilyName(f) {
        var fam = f && f.CardFontFamily != null ? String(f.CardFontFamily).trim() : '';
        if (!fam) fam = 'Medieval';
        return fam;
    }

    function cardFontCss(px, f) {
        var fam = cardFontFamilyName(f);
        var n = Math.round(px);
        if (typeof CardMakerFonts !== 'undefined') {
            return n + 'px ' + CardMakerFonts.cssStack(fam);
        }
        if (/\s/.test(fam)) return n + 'px "' + fam.replace(/"/g, '') + '", Medieval, serif';
        return n + 'px ' + fam + ', Medieval, serif';
    }

    function fieldOn(v) {
        if (v === true || v === 1) return true;
        if (v === false || v === 0 || v == null || v === '') return false;
        var s = String(v).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'on' || s === 'yes';
    }

    /** Editor checkboxes default to checked when a save omits the field. */
    function fieldOnDefaultTrue(v) {
        if (v === undefined || v === null || v === '') return true;
        return fieldOn(v);
    }

    function fieldNum(v, fallback) {
        if (v === undefined || v === null || v === '') return fallback;
        var n = typeof v === 'number' ? v : parseFloat(String(v));
        return isFinite(n) ? n : fallback;
    }

    function ensureCardFont(f) {
        var fam = cardFontFamilyName(f);
        if (typeof CardMakerFonts !== 'undefined') {
            return CardMakerFonts.ensureLoaded(fam);
        }
        try {
            return document.fonts.load('200px Medieval').catch(function () { return null; });
        } catch (e) {
            return Promise.resolve(null);
        }
    }

    /**
     * Loads pixels in a way that keeps an offscreen canvas exportable (toDataURL).
     * Remote http(s) URLs use CORS fetch + ImageBitmap when possible; data/blob URLs use Image.
     */
    /** Same-directory default as index.html / saved-projects (preview when save has no usable frame). */
    function defaultCardFrameSrc() {
        try {
            if (typeof location !== 'undefined' && location.href) {
                return new URL('CardFrame.png', location.href).href;
            }
        } catch (e) { /* ignore */ }
        return 'CardFrame.png';
    }

    function loadImage(src) {
        return new Promise(function (resolve) {
            if (!src || String(src).length < 8) {
                resolve(null);
                return;
            }
            var s = String(src);
            if (/^\/\//.test(s)) {
                s = (typeof location !== 'undefined' && location.protocol ? location.protocol : 'https:') + s;
            }
            if (/^data:/i.test(s) || /^blob:/i.test(s)) {
                var d = new Image();
                d.onload = function () { resolve(d); };
                d.onerror = function () { resolve(null); };
                d.src = s;
                return;
            }
            if (/^https?:\/\//i.test(s)) {
                if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
                    fetch(s, { mode: 'cors', credentials: 'omit' })
                        .then(function (r) {
                            if (!r.ok) throw new Error('HTTP ' + r.status);
                            return r.blob();
                        })
                        .then(function (blob) {
                            return createImageBitmap(blob);
                        })
                        .then(function (bmp) {
                            resolve(bmp);
                        })
                        .catch(function () {
                            var img = new Image();
                            img.crossOrigin = 'anonymous';
                            img.onload = function () { resolve(img); };
                            img.onerror = function () { resolve(null); };
                            img.src = s;
                        });
                    return;
                }
                var imgHttp = new Image();
                imgHttp.crossOrigin = 'anonymous';
                imgHttp.onload = function () { resolve(imgHttp); };
                imgHttp.onerror = function () { resolve(null); };
                imgHttp.src = s;
                return;
            }
            var rel = new Image();
            rel.onload = function () { resolve(rel); };
            rel.onerror = function () { resolve(null); };
            rel.src = s;
        });
    }

    function wrapMaxWidth(canvasW, wrapPct) {
        var p = parseFloat(wrapPct);
        if (!isFinite(p) || p <= 0) return canvasW - (canvasW / 4.75);
        return canvasW * (Math.max(30, Math.min(100, p)) / 100);
    }

    function measureWrapWidth(ctx, text) {
        var m = ctx.measureText(text || '');
        var w = m.width;
        if (typeof m.actualBoundingBoxLeft === 'number' && typeof m.actualBoundingBoxRight === 'number') {
            w = Math.max(w, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
        }
        return w;
    }

    function splitWordToWidth(ctx, word, maxWidth) {
        if (!word) return [''];
        if (measureWrapWidth(ctx, word) <= maxWidth) return [word];
        var parts = [];
        var rest = word;
        while (rest.length) {
            if (measureWrapWidth(ctx, rest) <= maxWidth) {
                parts.push(rest);
                break;
            }
            var lo = 1;
            var hi = rest.length;
            while (lo < hi) {
                var mid = Math.ceil((lo + hi) / 2);
                if (measureWrapWidth(ctx, rest.slice(0, mid)) <= maxWidth) lo = mid;
                else hi = mid - 1;
            }
            if (lo < 1) lo = 1;
            parts.push(rest.slice(0, lo));
            rest = rest.slice(lo);
        }
        return parts;
    }

    function wrapTextLines(ctx, text, maxWidth) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        var limit = Math.max(8, maxWidth - 2);
        var lines = [];
        var paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n');
        for (var p = 0; p < paragraphs.length; p++) {
            var words = paragraphs[p].split(/\s+/).filter(Boolean);
            if (!words.length) {
                lines.push('');
                continue;
            }
            var line = '';
            for (var index = 0; index < words.length; index++) {
                var chunks = splitWordToWidth(ctx, words[index], limit);
                for (var c = 0; c < chunks.length; c++) {
                    var piece = chunks[c];
                    var testLine = line ? (line + ' ' + piece) : piece;
                    if (line && measureWrapWidth(ctx, testLine) > limit) {
                        lines.push(line);
                        line = piece;
                    } else {
                        line = testLine;
                    }
                }
            }
            if (line) lines.push(line);
        }
        ctx.restore();
        return lines;
    }

    /** Right-aligned set title: shrink font to fit, then up to 3 wrapped lines (no early “…” unless still impossible). */
    function drawSetNameBottomRight(ctx, rawName, rightX, centerY, maxWidth, f, fontScale) {
        var name = String(rawName || '').trim();
        if (!name) return;
        var fs = fontScale != null ? fontScale : 1;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        var px;
        for (px = Math.round(64 * fs); px >= Math.round(28 * fs); px -= Math.max(1, Math.round(2 * fs))) {
            ctx.font = cardFontCss(px, f);
            if (ctx.measureText(name).width <= maxWidth) {
                ctx.fillText(name, rightX, centerY);
                return;
            }
        }
        ctx.font = cardFontCss(28 * fs, f);
        var lines = wrapTextLines(ctx, name, maxWidth);
        var maxLines = 3;
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            var last = lines[maxLines - 1];
            while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) {
                last = last.slice(0, -1);
            }
            lines[maxLines - 1] = last + '…';
        }
        if (lines.length === 1 && ctx.measureText(lines[0]).width > maxWidth) {
            var w = lines[0];
            while (w.length > 1 && ctx.measureText(w + '…').width > maxWidth) {
                w = w.slice(0, -1);
            }
            ctx.fillText(w + '…', rightX, centerY);
            return;
        }
        var lineH = 34 * fs;
        var startY = centerY - ((lines.length - 1) * lineH) / 2;
        for (var li = 0; li < lines.length; li++) {
            ctx.fillText(lines[li], rightX, startY + li * lineH);
        }
    }

    /**
     * @param {object} parsed
     * @param {object} [options]
     * @param {number} [options.maxOutputSide] If set (e.g. 400), scale the final card to fit within this max width/height and encode (default: full 2500×3500 PNG).
     * @param {string} [options.outputMime] With maxOutputSide, use 'image/jpeg' for smaller/faster output (default jpeg when maxOutputSide set).
     * @param {number} [options.outputQuality] JPEG quality 0–1 (default 0.82).
     * @returns {Promise<string|null>} PNG or JPEG data URL or null
     */
    async function renderCardMakerProjectToDataUrl(parsed, options) {
        if (!parsed || typeof parsed !== 'object') return null;
        var opts = options && typeof options === 'object' ? options : null;
        var images = parsed.images || {};
        var f = parsed.fields || {};
        var mainSrc = images.cardBaseSrc;
        var artSrc = images.artSrc;

        var artPromise = loadImage(artSrc);
        var mainImg = await loadImage(mainSrc);
        if (!mainImg) {
            mainImg = await loadImage(defaultCardFrameSrc());
        }
        var artImg = await artPromise;
        if (!mainImg && !artImg) return null;

        var maxOut = opts && typeof opts.maxOutputSide === 'number' ? opts.maxOutputSide : 0;
        var useEditorLive = maxOut > 0 && maxOut < CANVAS_W;
        var layoutW = useEditorLive ? Math.round(CANVAS_W * EDITOR_LIVE_SCALE) : CANVAS_W;
        var layoutH = useEditorLive ? Math.round(CANVAS_H * EDITOR_LIVE_SCALE) : CANVAS_H;
        var renderScale = layoutW / CANVAS_W;

        var canvas = document.createElement('canvas');
        canvas.width = layoutW;
        canvas.height = layoutH;
        var ctx = canvas.getContext('2d');
        if (!ctx) return null;
        var W = layoutW;
        var H = layoutH;
        var fs = renderScale;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        try { ctx.imageSmoothingQuality = 'high'; } catch (eSm) { /* ignore */ }
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'black';

        await ensureCardFont(f);

        var ExtraHightP = fieldNum(f.ArtHightPos, 0) * fs;
        var ExtraWidthP = fieldNum(f.ArtWidthPos, 0) * fs;
        var artSize = fieldNum(f.ArtHight, 116);

        if (artImg) {
            var aw = artImg.width || (artImg.naturalWidth && artImg.naturalWidth);
            if (aw) {
                var mgWidth = aw * (artSize / 100) * fs;
                var mgHeight = (artImg.height || artImg.naturalHeight) * (artSize / 100) * fs;
                ctx.drawImage(artImg, (W - mgWidth - ExtraWidthP) / 2, (H - mgHeight - ExtraHightP) / 8, mgWidth, mgHeight);
            }
        }

        if (mainImg) {
            var mw = mainImg.width || mainImg.naturalWidth;
            var mh = mainImg.height || mainImg.naturalHeight;
            if (mw && mh) {
                var aspectRatio = mw / mh;
                var imgWidth = W;
                var imgHeight = imgWidth / aspectRatio;
                if (imgHeight > H) {
                    imgHeight = H;
                    imgWidth = imgHeight * aspectRatio;
                }
                ctx.drawImage(mainImg, (W - imgWidth) / 2, (H - imgHeight) / 8, imgWidth, imgHeight);
            }
        }

        var showDamage = fieldOn(f.showDamageStats);
        var mainW = mainImg && (mainImg.width || mainImg.naturalWidth);
        var mainH = mainImg && (mainImg.height || mainImg.naturalHeight);
        var aspectRatios = mainW && mainH ? (mainW / mainH) : 1;
        var DimgWidth = W;
        var DimgHeight = DimgWidth / aspectRatios;
        if (DimgHeight > H) {
            DimgHeight = H;
            DimgWidth = DimgHeight * aspectRatios;
        }
        var dImgX = (W - DimgWidth) / 2;
        var dImgY = (H - DimgHeight) / 8;

        function rarityTierShowsGem(r) {
            var order = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Fantastical'];
            var idx = order.indexOf(String(r || '').trim());
            var uncommonIdx = order.indexOf('Uncommon');
            return idx >= uncommonIdx && uncommonIdx >= 0;
        }

        var RARITY_HEX = {
            Common: '#78716c',
            Uncommon: '#ffffff',
            Rare: '#3b82f6',
            Epic: '#8b5cf6',
            Legendary: '#d1bc43',
            Mythic: '#ef4444',
            Fantastical: '#10b981'
        };
        function rarityHex(r) {
            var k = String(r || '').trim();
            return RARITY_HEX[k] || '#1e293b';
        }
        var RARITY_GEM_OVERLAY_ALPHA = 0.9;

        function rarityGemStableNoise(ix, iy) {
            var x = ix | 0;
            var y = iy | 0;
            var h = (x * 374761393 + y * 668265263) >>> 0;
            h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
            return (h & 65535) / 32767.5 - 1;
        }

        function applyRarityGemFilmGrain(tctx, tw, th) {
            var id = tctx.getImageData(0, 0, tw, th);
            var d = id.data;
            var strength = Math.max(12, Math.min(30, Math.floor((tw + th) / 55)));
            var iy, ix, i, n, b;
            for (iy = 0; iy < th; iy++) {
                for (ix = 0; ix < tw; ix++) {
                    i = (iy * tw + ix) * 4;
                    if (d[i + 3] < 10) continue;
                    n = rarityGemStableNoise(ix, iy);
                    b = n * strength;
                    d[i]     = Math.max(0, Math.min(255, d[i] + b));
                    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + b));
                    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + b));
                }
            }
            tctx.putImageData(id, 0, 0);
        }

        function drawTintedRarityOverlay(ctx, img, x, y, w, h, color) {
            var tw = Math.max(1, Math.round(w));
            var th = Math.max(1, Math.round(h));
            var t = document.createElement('canvas');
            t.width = tw;
            t.height = th;
            var tctx = t.getContext('2d');
            if (!tctx) return;
            tctx.clearRect(0, 0, tw, th);
            tctx.drawImage(img, 0, 0, tw, th);
            tctx.globalCompositeOperation = 'source-atop';
            tctx.fillStyle = color;
            tctx.fillRect(0, 0, tw, th);
            tctx.globalCompositeOperation = 'source-over';
            applyRarityGemFilmGrain(tctx, tw, th);
            ctx.save();
            ctx.globalAlpha = RARITY_GEM_OVERLAY_ALPHA;
            ctx.drawImage(t, x, y);
            ctx.restore();
        }

        function drawUntintedRarityGemWithGrain(ctx, img, x, y, w, h) {
            var tw = Math.max(1, Math.round(w));
            var th = Math.max(1, Math.round(h));
            var t = document.createElement('canvas');
            t.width = tw;
            t.height = th;
            var tctx = t.getContext('2d');
            if (!tctx) return;
            tctx.drawImage(img, 0, 0, tw, th);
            applyRarityGemFilmGrain(tctx, tw, th);
            ctx.save();
            ctx.globalAlpha = RARITY_GEM_OVERLAY_ALPHA;
            ctx.drawImage(t, x, y);
            ctx.restore();
        }

        if (showDamage && mainImg && mainW && mainH) {
            var damageImg = await loadImage('Damage.png');
            var dw = damageImg && (damageImg.width || damageImg.naturalWidth);
            if (dw) {
                ctx.drawImage(damageImg, dImgX, dImgY, DimgWidth, DimgHeight);
            }
            ctx.font = cardFontCss(175 * fs, f);
            ctx.textAlign = 'center';
            ctx.fillStyle = 'black';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(f.DamageID != null ? f.DamageID : ''), W / 12.5, H / 12.5);
            ctx.fillText(String(f.DefenseID != null ? f.DefenseID : ''), W - (W / 12.5), H / 12.5);
        }
        if (mainImg && mainW && mainH && rarityTierShowsGem(f.Rarity)) {
            var rarityImg = await loadImage('Rareity.png');
            var rw = rarityImg && (rarityImg.width || rarityImg.naturalWidth);
            if (rw) {
                var gemTier = String(f.Rarity || '').trim();
                if (gemTier === 'Uncommon') {
                    drawUntintedRarityGemWithGrain(ctx, rarityImg, dImgX, dImgY, DimgWidth, DimgHeight);
                } else {
                    drawTintedRarityOverlay(ctx, rarityImg, dImgX, dImgY, DimgWidth, DimgHeight, rarityHex(f.Rarity));
                }
            }
        }

        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'black';

        var titleCenter = fieldOnDefaultTrue(f.TitleCenterAlign);
        ctx.font = cardFontCss((fieldNum(f.TitleFontSize, 200)) * fs, f);
        ctx.textAlign = titleCenter ? 'center' : 'left';
        var titleX = titleCenter ? (W / 2) : (W / 10);
        ctx.fillText(String(f.Title != null ? f.Title : ''), titleX, H / 12.5);

        ctx.font = cardFontCss((fieldNum(f.TypeFontSize, 100)) * fs, f);
        ctx.textAlign = 'center';
        ctx.fillText(String(f.Type != null ? f.Type : ''), (W / 5), H / 7.3);

        ctx.font = cardFontCss((fieldNum(f.SubtypeFontSize, 80)) * fs, f);
        ctx.fillText(String(f.Subtype != null ? f.Subtype : ''), W - (W / 5), H / 7.3);

        ctx.font = cardFontCss((fieldNum(f.TreasureFontSize, 150)) * fs, f);
        ctx.fillText(String(f.TreasureCost != null ? f.TreasureCost : ''), W - (W / 6.9), H / 1.99);

        var quoteCenter = fieldOnDefaultTrue(f.QuoteCenterAlign);
        var quoteFontPx = fieldNum(f.QoteDiscriptionFontSize, 60);
        ctx.font = cardFontCss(quoteFontPx * fs, f);
        ctx.textAlign = quoteCenter ? 'center' : 'left';
        var quoteX = quoteCenter ? (W / 2) : (W / 10);
        ctx.fillText(String(f.QoteDiscription != null ? f.QoteDiscription : ''), quoteX, H - (H / 13));

        var rawSetN = f.CardSetNumber;
        var rawSetT = f.CardSetTotal;
        var setNum = (rawSetN === undefined || rawSetN === null || String(rawSetN).trim() === '')
            ? NaN : parseInt(String(rawSetN).trim(), 10);
        var setTot = (rawSetT === undefined || rawSetT === null || String(rawSetT).trim() === '')
            ? NaN : parseInt(String(rawSetT).trim(), 10);
        var hasSetNums = setNum >= 1 && setTot >= 1;

        var rarShown = f.Rarity != null ? String(f.Rarity).trim() : '';
        var setNameStr = f.CardMakerSetName != null ? String(f.CardMakerSetName).trim() : '';
        if (hasSetNums || rarShown || setNameStr) {
            var rarityY = H - (H / 28);
            var setDigitFontPx = Math.round(80 * fs);
            var setSlashFontPx = Math.round(138 * fs);
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            var leftPadX = W / 10;
            var gapBetween = W * 0.022;
            var rarityX = leftPadX;
            if (hasSetNums) {
                ctx.textAlign = 'left';
                var sx = leftPadX;
                var sLeft = String(setNum);
                var sRight = String(setTot);
                ctx.font = cardFontCss(setDigitFontPx, f);
                ctx.fillText(sLeft, sx, rarityY);
                sx += ctx.measureText(sLeft).width + ctx.measureText(' ').width / 2;
                ctx.font = cardFontCss(setSlashFontPx, f);
                ctx.fillText('/', sx, rarityY);
                sx += ctx.measureText('/').width;
                ctx.font = cardFontCss(setDigitFontPx, f);
                sx += ctx.measureText(' ').width / 2;
                ctx.fillText(sRight, sx, rarityY);
                sx += ctx.measureText(sRight).width;
                rarityX = sx + gapBetween;
            }
            if (rarShown) {
                ctx.textAlign = 'left';
                ctx.font = cardFontCss(70 * fs, f);
                ctx.fillText(rarShown, rarityX, rarityY);
            }
            if (setNameStr) {
                var rightPadX = W - (W / 10);
                var maxNameW = W * 0.52;
                drawSetNameBottomRight(ctx, setNameStr, rightPadX, rarityY, maxNameW, f, fs);
            }
            ctx.fillStyle = 'black';
        }

        var mainCenter = fieldOnDefaultTrue(f.MainDescriptionCenterAlign);
        var mainFontPx = fieldNum(f.MainDisciptionFontSize, 125);
        ctx.font = cardFontCss(mainFontPx * fs, f);
        ctx.textAlign = mainCenter ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        var mainOx = fieldNum(f.MainDisciptionPosX, 0) * fs;
        var mainOy = fieldNum(f.MainDisciptionPosY, 0) * fs;
        var descriptionX = (mainCenter ? (W / 2) : (W / 10)) + mainOx;
        var maxW = wrapMaxWidth(W, f.MainDisciptionWrap != null && f.MainDisciptionWrap !== '' ? f.MainDisciptionWrap : 79);
        var mainLineH = 125 * fs;
        var mainBoxLeft = mainCenter ? (descriptionX - maxW / 2) : descriptionX;
        var mainLines = wrapTextLines(ctx, f.MainDisciption || '', maxW);
        ctx.save();
        ctx.beginPath();
        ctx.rect(mainBoxLeft, 0, maxW, H);
        ctx.clip();
        ctx.font = cardFontCss(mainFontPx * fs, f);
        ctx.textAlign = mainCenter ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'black';
        var i;
        for (i = 0; i < mainLines.length; i++) {
            ctx.fillText(mainLines[i], descriptionX, (H / 1.6) + mainOy + (mainLineH * (i + 1)));
        }
        ctx.restore();

        var subCenter = fieldOnDefaultTrue(f.SubDescriptionCenterAlign);
        var subFontPx = fieldNum(f.SubDisciptionFontSize, 70);
        ctx.font = cardFontCss(subFontPx * fs, f);
        ctx.textAlign = subCenter ? 'center' : 'left';
        var subOx = fieldNum(f.SubDisciptionPosX, 0) * fs;
        var subOy = fieldNum(f.SubDisciptionPosY, 0) * fs;
        var subDescriptionX = (subCenter ? (W / 2) : (W / 10)) + subOx;
        var subMaxW = wrapMaxWidth(W, f.SubDisciptionWrap != null && f.SubDisciptionWrap !== '' ? f.SubDisciptionWrap : 79);
        var subLineH = 100 * fs;
        var subBoxLeft = subCenter ? (subDescriptionX - subMaxW / 2) : subDescriptionX;
        var subLines = wrapTextLines(ctx, f.SubDisciption || '', subMaxW);
        ctx.save();
        ctx.beginPath();
        ctx.rect(subBoxLeft, 0, subMaxW, H);
        ctx.clip();
        ctx.font = cardFontCss(subFontPx * fs, f);
        ctx.textAlign = subCenter ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'black';
        for (i = 0; i < subLines.length; i++) {
            ctx.fillText(subLines[i], subDescriptionX, (H / 1.9) + subOy + (subLineH * (i + 1)));
        }
        ctx.restore();

        var exportCanvas = canvas;
        if (useEditorLive && maxOut > 0) {
            var fit = Math.min(maxOut / layoutW, maxOut / layoutH);
            if (fit < 0.999) {
                var finalW = Math.max(1, Math.round(layoutW * fit));
                var finalH = Math.max(1, Math.round(layoutH * fit));
                var out = document.createElement('canvas');
                out.width = finalW;
                out.height = finalH;
                var octx = out.getContext('2d');
                if (octx) {
                    octx.imageSmoothingEnabled = true;
                    try { octx.imageSmoothingQuality = 'high'; } catch (eFit) { /* ignore */ }
                    octx.drawImage(canvas, 0, 0, finalW, finalH);
                    exportCanvas = out;
                }
            }
        }

        try {
            if (maxOut > 0) {
                var wantJpeg = !opts || !opts.outputMime || opts.outputMime === 'image/jpeg' || opts.outputMime === 'jpeg';
                if (wantJpeg) {
                    var q = typeof opts.outputQuality === 'number' ? opts.outputQuality : 0.82;
                    return exportCanvas.toDataURL('image/jpeg', q);
                }
            }
            return exportCanvas.toDataURL('image/png');
        } catch (e) {
            console.warn('card-render: toDataURL failed (tainted or blocked canvas)', e);
            return null;
        }
    }

    window.renderCardMakerProjectToDataUrl = renderCardMakerProjectToDataUrl;
})();
