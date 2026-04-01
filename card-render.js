/**
 * Renders a Card Maker project JSON (same shape as buildProjectState in index.html)
 * to a PNG data URL, matching the main editor canvas (2500×3500).
 */
(function () {
    var CANVAS_W = 2500;
    var CANVAS_H = 3500;

    /**
     * Loads pixels in a way that keeps an offscreen canvas exportable (toDataURL).
     * Remote http(s) URLs use CORS fetch + ImageBitmap when possible; data/blob URLs use Image.
     */
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

    function wrapTextLines(ctx, text, maxWidth) {
        var words = String(text || '').split(/\s+/).filter(Boolean);
        var line = '';
        var lines = [];
        for (var index = 0; index < words.length; index++) {
            var word = words[index];
            var testLine = line + word + ' ';
            if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
                lines.push(line.trim());
                line = word + ' ';
            } else {
                line = testLine;
            }
        }
        if (line.length > 0) lines.push(line.trim());
        return lines;
    }

    /**
     * @param {object} parsed
     * @returns {Promise<string|null>} PNG data URL or null
     */
    async function renderCardMakerProjectToDataUrl(parsed) {
        if (!parsed || typeof parsed !== 'object') return null;
        var images = parsed.images || {};
        var f = parsed.fields || {};
        var mainSrc = images.cardBaseSrc;
        var artSrc = images.artSrc;

        var mainImg = await loadImage(mainSrc);
        var artImg = await loadImage(artSrc);
        if (!mainImg && !artImg) return null;

        var canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = 'black';

        try {
            await document.fonts.load('200px Medieval');
        } catch (e) { /* ignore */ }

        var ExtraHightP = parseInt(f.ArtHightPos, 10) || 0;
        var ExtraWidthP = parseInt(f.ArtWidthPos, 10) || 0;
        var artSize = parseInt(f.ArtHight, 10) || 100;

        if (artImg) {
            var aw = artImg.width || (artImg.naturalWidth && artImg.naturalWidth);
            if (aw) {
                var mgWidth = aw * (artSize / 100);
                var mgHeight = (artImg.height || artImg.naturalHeight) * (artSize / 100);
                ctx.drawImage(artImg, (CANVAS_W - mgWidth - ExtraWidthP) / 2, (CANVAS_H - mgHeight - ExtraHightP) / 8, mgWidth, mgHeight);
            }
        }

        if (mainImg) {
            var mw = mainImg.width || mainImg.naturalWidth;
            var mh = mainImg.height || mainImg.naturalHeight;
            if (mw && mh) {
                var aspectRatio = mw / mh;
                var imgWidth = CANVAS_W;
                var imgHeight = imgWidth / aspectRatio;
                if (imgHeight > CANVAS_H) {
                    imgHeight = CANVAS_H;
                    imgWidth = imgHeight * aspectRatio;
                }
                ctx.drawImage(mainImg, (CANVAS_W - imgWidth) / 2, (CANVAS_H - imgHeight) / 8, imgWidth, imgHeight);
            }
        }

        var showDamage = !!f.showDamageStats;
        var mainW = mainImg && (mainImg.width || mainImg.naturalWidth);
        var mainH = mainImg && (mainImg.height || mainImg.naturalHeight);
        var aspectRatios = mainW && mainH ? (mainW / mainH) : 1;
        var DimgWidth = CANVAS_W;
        var DimgHeight = DimgWidth / aspectRatios;
        if (DimgHeight > CANVAS_H) {
            DimgHeight = CANVAS_H;
            DimgWidth = DimgHeight * aspectRatios;
        }
        var dImgX = (CANVAS_W - DimgWidth) / 2;
        var dImgY = (CANVAS_H - DimgHeight) / 8;

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
            Legendary: '#f59e0b',
            Mythic: '#ef4444',
            Fantastical: '#10b981'
        };
        function rarityHex(r) {
            var k = String(r || '').trim();
            return RARITY_HEX[k] || '#1e293b';
        }
        var RARITY_GEM_OVERLAY_ALPHA = 0.5;

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
            ctx.font = '175px Medieval';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'black';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(f.DamageID != null ? f.DamageID : ''), CANVAS_W / 12.5, CANVAS_H / 12.5);
            ctx.fillText(String(f.DefenseID != null ? f.DefenseID : ''), CANVAS_W - (CANVAS_W / 12.5), CANVAS_H / 12.5);
        }
        if (mainImg && mainW && mainH && rarityTierShowsGem(f.Rarity)) {
            var rarityImg = await loadImage('Rareity.png');
            var rw = rarityImg && (rarityImg.width || rarityImg.naturalWidth);
            if (rw) {
                var gemTier = String(f.Rarity || '').trim();
                if (gemTier === 'Uncommon') {
                    ctx.save();
                    ctx.globalAlpha = RARITY_GEM_OVERLAY_ALPHA;
                    ctx.drawImage(rarityImg, dImgX, dImgY, DimgWidth, DimgHeight);
                    ctx.restore();
                } else {
                    drawTintedRarityOverlay(ctx, rarityImg, dImgX, dImgY, DimgWidth, DimgHeight, rarityHex(f.Rarity));
                }
            }
        }

        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'black';

        ctx.font = (parseInt(f.TitleFontSize, 10) || 200) + 'px Medieval';
        ctx.textAlign = f.TitleCenterAlign ? 'center' : 'left';
        var titleX = f.TitleCenterAlign ? (CANVAS_W / 2) : (CANVAS_W / 10);
        ctx.fillText(String(f.Title != null ? f.Title : ''), titleX, CANVAS_H / 12.5);

        ctx.font = (parseInt(f.TypeFontSize, 10) || 100) + 'px Medieval';
        ctx.textAlign = 'center';
        ctx.fillText(String(f.Type != null ? f.Type : ''), (CANVAS_W / 5), CANVAS_H / 7.3);

        ctx.font = (parseInt(f.SubtypeFontSize, 10) || 80) + 'px Medieval';
        ctx.fillText(String(f.Subtype != null ? f.Subtype : ''), CANVAS_W - (CANVAS_W / 5), CANVAS_H / 7.3);

        ctx.font = (parseInt(f.TreasureFontSize, 10) || 150) + 'px Medieval';
        ctx.fillText(String(f.TreasureCost != null ? f.TreasureCost : ''), CANVAS_W - (CANVAS_W / 6.9), CANVAS_H / 1.99);

        var quoteFontPx = parseInt(f.QoteDiscriptionFontSize, 10) || 60;
        ctx.font = quoteFontPx + 'px Medieval';
        ctx.textAlign = f.QuoteCenterAlign ? 'center' : 'left';
        var quoteX = f.QuoteCenterAlign ? (CANVAS_W / 2) : (CANVAS_W / 10);
        ctx.fillText(String(f.QoteDiscription != null ? f.QoteDiscription : ''), quoteX, CANVAS_H - (CANVAS_H / 13));

        var rawSetN = f.CardSetNumber;
        var rawSetT = f.CardSetTotal;
        var setNum = (rawSetN === undefined || rawSetN === null)
            ? 1 : parseInt(String(rawSetN).trim(), 10);
        var setTot = (rawSetT === undefined || rawSetT === null)
            ? 120 : parseInt(String(rawSetT).trim(), 10);
        var hasSetNums = setNum >= 1 && setTot >= 1;

        var rarShown = f.Rarity != null ? String(f.Rarity).trim() : '';
        if (hasSetNums || rarShown) {
            var rarityY = CANVAS_H - (CANVAS_H / 28);
            var setDigitFontPx = 80;
            var setSlashFontPx = 138;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            var leftPadX = CANVAS_W / 10;
            var gapBetween = CANVAS_W * 0.022;
            var rarityX = leftPadX;
            if (hasSetNums) {
                var sx = leftPadX;
                var sLeft = String(setNum);
                var sRight = String(setTot);
                ctx.font = setDigitFontPx + 'px Medieval';
                ctx.fillText(sLeft, sx, rarityY);
                sx += ctx.measureText(sLeft).width + ctx.measureText(' ').width / 2;
                ctx.font = setSlashFontPx + 'px Medieval';
                ctx.fillText('/', sx, rarityY);
                sx += ctx.measureText('/').width;
                ctx.font = setDigitFontPx + 'px Medieval';
                sx += ctx.measureText(' ').width / 2;
                ctx.fillText(sRight, sx, rarityY);
                sx += ctx.measureText(sRight).width;
                rarityX = sx + gapBetween;
            }
            if (rarShown) {
                ctx.font = '70px Medieval';
                ctx.fillText(rarShown, rarityX, rarityY);
            }
            ctx.fillStyle = 'black';
        }

        ctx.font = (parseInt(f.MainDisciptionFontSize, 10) || 125) + 'px Medieval';
        ctx.textAlign = f.MainDescriptionCenterAlign ? 'center' : 'left';
        var descriptionX = f.MainDescriptionCenterAlign ? (CANVAS_W / 2) : (CANVAS_W / 10);
        var maxW = CANVAS_W - (CANVAS_W / 4.75);
        var mainLines = wrapTextLines(ctx, f.MainDisciption || '', maxW);
        var i;
        for (i = 0; i < mainLines.length; i++) {
            ctx.fillText(mainLines[i], descriptionX, (CANVAS_H / 1.6) + (125 * (i + 1)));
        }

        ctx.font = (parseInt(f.SubDisciptionFontSize, 10) || 70) + 'px Medieval';
        ctx.textAlign = f.SubDescriptionCenterAlign ? 'center' : 'left';
        var subDescriptionX = f.SubDescriptionCenterAlign ? (CANVAS_W / 2) : (CANVAS_W / 10);
        var subLines = wrapTextLines(ctx, f.SubDisciption || '', maxW);
        for (i = 0; i < subLines.length; i++) {
            ctx.fillText(subLines[i], subDescriptionX, (CANVAS_H / 1.9) + (100 * (i + 1)));
        }

        try {
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('card-render: toDataURL failed (tainted or blocked canvas)', e);
            return null;
        }
    }

    window.renderCardMakerProjectToDataUrl = renderCardMakerProjectToDataUrl;
})();
