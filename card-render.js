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
        if (showDamage && mainImg && mainW && mainH) {
            var damageImg = await loadImage('Damage.png');
            var dw = damageImg && (damageImg.width || damageImg.naturalWidth);
            if (dw) {
                var aspectRatios = mainW / mainH;
                var DimgWidth = CANVAS_W;
                var DimgHeight = DimgWidth / aspectRatios;
                if (DimgHeight > CANVAS_H) {
                    DimgHeight = CANVAS_H;
                    DimgWidth = DimgHeight * aspectRatios;
                }
                ctx.drawImage(damageImg, (CANVAS_W - DimgWidth) / 2, (CANVAS_H - DimgHeight) / 8, DimgWidth, DimgHeight);
            }
            ctx.font = '175px Medieval';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'black';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(f.DamageID != null ? f.DamageID : ''), CANVAS_W / 12.5, CANVAS_H / 12.5);
            ctx.fillText(String(f.DefenseID != null ? f.DefenseID : ''), CANVAS_W - (CANVAS_W / 12.5), CANVAS_H / 12.5);
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

        ctx.font = (parseInt(f.QoteDiscriptionFontSize, 10) || 80) + 'px Medieval';
        ctx.textAlign = f.QuoteCenterAlign ? 'center' : 'left';
        var quoteX = f.QuoteCenterAlign ? (CANVAS_W / 2) : (CANVAS_W / 10);
        ctx.fillText(String(f.QoteDiscription != null ? f.QoteDiscription : ''), quoteX, CANVAS_H - (CANVAS_H / 13));

        ctx.font = (parseInt(f.MainDisciptionFontSize, 10) || 80) + 'px Medieval';
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
