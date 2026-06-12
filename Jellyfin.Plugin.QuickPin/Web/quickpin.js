/* QuickPin – écran de connexion par profils + PIN, optimisé TV.
 * Compatible jellyfin-web 10.9 → 10.11, navigateurs TV (Tizen/webOS) et desktop.
 * ES5 + fetch/Promise (disponibles sur Tizen 3+ / Chromium 47+).
 */
(function () {
    'use strict';

    if (window.__quickPinLoaded) { return; }
    window.__quickPinLoaded = true;

    var STYLE_ID = 'quickpin-style';
    var OVERLAY_ID = 'quickpin-overlay';
    var SKIP_KEY = 'qp_skip';
    var COLORS = ['#00a4dc', '#aa5cc3', '#48c78e', '#e6a23c', '#dd6b66', '#5470c6'];

    /* ------------------------------------------------------------------ */
    /* Base URL du serveur                                                 */
    /* ------------------------------------------------------------------ */

    function getBase() {
        // 1) ApiClient déjà initialisé (cas jellyfin-web servi par le serveur)
        try {
            if (window.ApiClient && typeof window.ApiClient.serverAddress === 'function') {
                var a = window.ApiClient.serverAddress();
                if (a) { return stripSlash(a); }
            }
        } catch (e) { /* ignore */ }

        // 2) Credentials stockés (cas Tizen : app locale, serveur distant)
        try {
            var raw = localStorage.getItem('jellyfin_credentials');
            if (raw) {
                var creds = JSON.parse(raw);
                if (creds && creds.Servers && creds.Servers.length) {
                    var s = pickLastServer(creds.Servers);
                    var addr = s.ManualAddress || s.LocalAddress || s.RemoteAddress || s.Address;
                    if (addr) { return stripSlash(addr); }
                }
            }
        } catch (e) { /* ignore */ }

        // 3) Fallback : origine courante, en retirant /web/...
        if (location.protocol === 'http:' || location.protocol === 'https:') {
            var path = location.pathname;
            var i = path.toLowerCase().indexOf('/web/');
            var basePath = i >= 0 ? path.substring(0, i) : '';
            return stripSlash(location.origin + basePath);
        }
        return null;
    }

    function pickLastServer(servers) {
        var best = servers[0];
        for (var i = 1; i < servers.length; i++) {
            var a = Date.parse(servers[i].DateLastAccessed || 0) || 0;
            var b = Date.parse(best.DateLastAccessed || 0) || 0;
            if (a > b) { best = servers[i]; }
        }
        return best;
    }

    function stripSlash(u) { return String(u).replace(/\/+$/, ''); }

    /* ------------------------------------------------------------------ */
    /* Device                                                              */
    /* ------------------------------------------------------------------ */

    function getDeviceId() {
        var id = null;
        try { id = localStorage.getItem('_deviceId2'); } catch (e) { /* ignore */ }
        if (!id) {
            id = randomId();
            try { localStorage.setItem('_deviceId2', id); } catch (e) { /* ignore */ }
        }
        return id;
    }

    function randomId() {
        var s = '';
        for (var i = 0; i < 32; i++) {
            s += Math.floor(Math.random() * 16).toString(16);
        }
        return s;
    }

    function getDeviceName() {
        var ua = navigator.userAgent || '';
        if (/Tizen/i.test(ua)) { return 'Samsung TV'; }
        if (/Web0S|webOS/i.test(ua)) { return 'LG TV'; }
        return 'Navigateur (QuickPin)';
    }

    /* ------------------------------------------------------------------ */
    /* Détection de la page de connexion                                   */
    /* ------------------------------------------------------------------ */

    function isLoginRoute() {
        var h = location.hash || '';
        return /login/i.test(h);
    }

    function hasToken() {
        try {
            var raw = localStorage.getItem('jellyfin_credentials');
            if (!raw) { return false; }
            var creds = JSON.parse(raw);
            if (!creds || !creds.Servers) { return false; }
            for (var i = 0; i < creds.Servers.length; i++) {
                if (creds.Servers[i].AccessToken) { return true; }
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    var checking = false;

    function maybeShow() {
        if (!isLoginRoute()) {
            // On quitte la page login : nettoyer le flag "connexion classique"
            try { sessionStorage.removeItem(SKIP_KEY); } catch (e) { /* ignore */ }
            destroyOverlay();
            return;
        }
        try {
            if (sessionStorage.getItem(SKIP_KEY)) { return; }
        } catch (e) { /* ignore */ }
        if (document.getElementById(OVERLAY_ID) || checking) { return; }

        var base = getBase();
        if (!base) { return; }

        checking = true;
        fetch(base + '/QuickPin/Profiles')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                checking = false;
                if (!data || !data.Profiles || !data.Profiles.length) { return; }
                if (!isLoginRoute()) { return; }
                buildOverlay(base, data);
            })
            .catch(function () { checking = false; });
    }

    window.addEventListener('hashchange', maybeShow);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeShow);
    } else {
        maybeShow();
    }
    // Filet de sécurité : certaines navigations SPA ne déclenchent pas hashchange.
    setInterval(maybeShow, 1500);

    /* ------------------------------------------------------------------ */
    /* UI                                                                  */
    /* ------------------------------------------------------------------ */

    var state = null; // { base, data, view, focusables, focusIndex, selected, pin, busy }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) { return; }
        var css = '' +
'#' + OVERLAY_ID + '{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:#101010;z-index:99999;' +
'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
'font-family:"Noto Sans","Segoe UI",sans-serif;color:#fff;text-align:center;}' +
'#' + OVERLAY_ID + ' .qp-title{font-size:2.4em;font-weight:400;margin:0 0 1.2em;color:#eee;}' +
'#' + OVERLAY_ID + ' .qp-row{display:flex;flex-wrap:wrap;justify-content:center;gap:2.5em;}' +
'#' + OVERLAY_ID + ' .qp-card{background:none;border:none;cursor:pointer;outline:none;padding:0;' +
'display:flex;flex-direction:column;align-items:center;width:11em;}' +
'#' + OVERLAY_ID + ' .qp-avatar{width:9em;height:9em;border-radius:50%;overflow:hidden;' +
'display:flex;align-items:center;justify-content:center;font-size:1em;' +
'border:4px solid transparent;transition:transform .15s,border-color .15s;background:#2a2a2a;}' +
'#' + OVERLAY_ID + ' .qp-avatar img{width:100%;height:100%;object-fit:cover;}' +
'#' + OVERLAY_ID + ' .qp-initial{font-size:3.5em;font-weight:600;color:#fff;}' +
'#' + OVERLAY_ID + ' .qp-card:focus .qp-avatar,#' + OVERLAY_ID + ' .qp-card.qp-focus .qp-avatar' +
'{border-color:#00a4dc;transform:scale(1.08);}' +
'#' + OVERLAY_ID + ' .qp-name{margin-top:.8em;font-size:1.3em;color:#ccc;}' +
'#' + OVERLAY_ID + ' .qp-card:focus .qp-name,#' + OVERLAY_ID + ' .qp-card.qp-focus .qp-name{color:#fff;}' +
'#' + OVERLAY_ID + ' .qp-link{background:none;border:none;color:#888;font-size:1em;margin-top:3em;' +
'cursor:pointer;outline:none;padding:.4em 1em;border-radius:.3em;}' +
'#' + OVERLAY_ID + ' .qp-link:focus,#' + OVERLAY_ID + ' .qp-link.qp-focus{color:#fff;background:#2a2a2a;' +
'box-shadow:0 0 0 3px #00a4dc inset;}' +
'#' + OVERLAY_ID + ' .qp-dots{display:flex;gap:1em;justify-content:center;margin:1.5em 0 2em;}' +
'#' + OVERLAY_ID + ' .qp-dot{width:1.2em;height:1.2em;border-radius:50%;border:2px solid #666;}' +
'#' + OVERLAY_ID + ' .qp-dot.qp-fill{background:#00a4dc;border-color:#00a4dc;}' +
'#' + OVERLAY_ID + ' .qp-pad{display:grid;grid-template-columns:repeat(3,5.5em);gap:1em;justify-content:center;}' +
'#' + OVERLAY_ID + ' .qp-key{height:5.5em;font-size:1.6em;background:#222;color:#fff;border:none;' +
'border-radius:.5em;cursor:pointer;outline:none;transition:transform .1s;}' +
'#' + OVERLAY_ID + ' .qp-key:focus,#' + OVERLAY_ID + ' .qp-key.qp-focus' +
'{background:#2f2f2f;box-shadow:0 0 0 4px #00a4dc inset;transform:scale(1.05);}' +
'#' + OVERLAY_ID + ' .qp-key.qp-alt{font-size:1.1em;color:#bbb;}' +
'#' + OVERLAY_ID + ' .qp-msg{min-height:1.6em;margin-top:1.4em;font-size:1.1em;color:#ff7a7a;}' +
'#' + OVERLAY_ID + ' .qp-msg.qp-ok{color:#9ad7a5;}' +
'@keyframes qp-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-12px)}40%,80%{transform:translateX(12px)}}' +
'#' + OVERLAY_ID + ' .qp-shake{animation:qp-shake .35s;}';
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function buildOverlay(base, data) {
        injectStyle();
        destroyOverlay();

        var overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        document.body.appendChild(overlay);

        state = {
            base: base,
            data: data,
            view: 'profiles',
            focusables: [],
            focusIndex: 0,
            selected: null,
            pin: '',
            busy: false
        };

        renderProfiles();
        document.addEventListener('keydown', onKeyDown, true);
    }

    function destroyOverlay() {
        var el = document.getElementById(OVERLAY_ID);
        if (el && el.parentNode) { el.parentNode.removeChild(el); }
        if (state) {
            document.removeEventListener('keydown', onKeyDown, true);
            state = null;
        }
    }

    /* ----------------------------- Profils ----------------------------- */

    function renderProfiles() {
        var o = document.getElementById(OVERLAY_ID);
        if (!o || !state) { return; }
        state.view = 'profiles';
        state.pin = '';
        o.innerHTML = '';

        var title = document.createElement('h1');
        title.className = 'qp-title';
        title.textContent = state.data.Title || 'Qui est-ce ?';
        o.appendChild(title);

        var row = document.createElement('div');
        row.className = 'qp-row';
        o.appendChild(row);

        state.focusables = [];

        for (var i = 0; i < state.data.Profiles.length; i++) {
            (function (p, idx) {
                var card = document.createElement('button');
                card.className = 'qp-card';
                card.type = 'button';

                var avatar = document.createElement('div');
                avatar.className = 'qp-avatar';
                avatar.appendChild(makeAvatar(p, idx));
                card.appendChild(avatar);

                var name = document.createElement('div');
                name.className = 'qp-name';
                name.textContent = p.Name || '';
                card.appendChild(name);

                card.onclick = function () { selectProfile(p); };
                row.appendChild(card);
                state.focusables.push(card);
            })(state.data.Profiles[i], i);
        }

        if (state.data.ShowClassicLoginLink) {
            var link = document.createElement('button');
            link.className = 'qp-link';
            link.type = 'button';
            link.textContent = 'Connexion classique';
            link.onclick = classicLogin;
            o.appendChild(link);
            state.focusables.push(link);
        }

        setFocus(0);
    }

    function makeAvatar(p, idx) {
        if (p.HasImage) {
            var img = document.createElement('img');
            img.alt = '';
            img.src = state.base + '/Users/' + p.Id + '/Images/Primary?quality=90';
            img.onerror = function () {
                if (!img.__qpFallback) {
                    img.__qpFallback = true;
                    img.src = state.base + '/UserImage?userId=' + p.Id;
                } else if (img.parentNode) {
                    img.parentNode.replaceChild(makeInitial(p, idx), img);
                }
            };
            return img;
        }
        return makeInitial(p, idx);
    }

    function makeInitial(p, idx) {
        var d = document.createElement('div');
        d.className = 'qp-initial';
        d.textContent = (p.Name || '?').charAt(0).toUpperCase();
        d.style.width = '100%';
        d.style.height = '100%';
        d.style.display = 'flex';
        d.style.alignItems = 'center';
        d.style.justifyContent = 'center';
        d.style.background = COLORS[idx % COLORS.length];
        return d;
    }

    function classicLogin() {
        try { sessionStorage.setItem(SKIP_KEY, '1'); } catch (e) { /* ignore */ }
        destroyOverlay();
    }

    /* ------------------------------- PIN ------------------------------- */

    function selectProfile(p) {
        if (!state) { return; }
        state.selected = p;
        state.pin = '';
        renderPin();
    }

    function renderPin() {
        var o = document.getElementById(OVERLAY_ID);
        if (!o || !state) { return; }
        state.view = 'pin';
        o.innerHTML = '';

        var title = document.createElement('h1');
        title.className = 'qp-title';
        title.textContent = state.selected.Name;
        o.appendChild(title);

        var dots = document.createElement('div');
        dots.className = 'qp-dots';
        dots.id = 'qp-dots';
        o.appendChild(dots);

        var pad = document.createElement('div');
        pad.className = 'qp-pad';
        o.appendChild(pad);

        state.focusables = [];

        var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'back'];
        for (var i = 0; i < keys.length; i++) {
            (function (k) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'qp-key' + (k === 'del' || k === 'back' ? ' qp-alt' : '');
                btn.textContent = k === 'del' ? '⌫' : (k === 'back' ? 'Retour' : k);
                btn.onclick = function () { pressKey(k); };
                pad.appendChild(btn);
                state.focusables.push(btn);
            })(keys[i]);
        }

        var msg = document.createElement('div');
        msg.className = 'qp-msg';
        msg.id = 'qp-msg';
        o.appendChild(msg);

        renderDots();
        setFocus(4); // touche "5", au centre
    }

    function renderDots() {
        var dots = document.getElementById('qp-dots');
        if (!dots || !state) { return; }
        dots.innerHTML = '';
        var len = state.data.PinLength || 4;
        for (var i = 0; i < len; i++) {
            var d = document.createElement('div');
            d.className = 'qp-dot' + (i < state.pin.length ? ' qp-fill' : '');
            dots.appendChild(d);
        }
    }

    function pressKey(k) {
        if (!state || state.busy) { return; }
        if (k === 'back') { renderProfiles(); return; }
        if (k === 'del') {
            state.pin = state.pin.slice(0, -1);
            setMsg('');
            renderDots();
            return;
        }
        addDigit(k);
    }

    function addDigit(d) {
        if (!state || state.busy) { return; }
        var len = state.data.PinLength || 4;
        if (state.pin.length >= len) { return; }
        state.pin += d;
        setMsg('');
        renderDots();
        if (state.pin.length === len) { submit(); }
    }

    function setMsg(text, ok) {
        var msg = document.getElementById('qp-msg');
        if (msg) {
            msg.textContent = text || '';
            msg.className = 'qp-msg' + (ok ? ' qp-ok' : '');
        }
    }

    function submit() {
        if (!state || state.busy) { return; }
        state.busy = true;
        setMsg('Connexion…', true);

        var body = {
            UserId: state.selected.Id,
            Pin: state.pin,
            DeviceId: getDeviceId(),
            DeviceName: getDeviceName(),
            App: 'Jellyfin Web (QuickPin)',
            AppVersion: '1.0.0'
        };

        fetch(state.base + '/QuickPin/Authenticate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) {
            if (r.ok) { return r.json().then(onSuccess); }
            return r.json().catch(function () { return {}; }).then(function (err) {
                onFailure(r.status, err);
            });
        }).catch(function () {
            onFailure(0, {});
        });
    }

    function onFailure(status, err) {
        if (!state) { return; }
        state.busy = false;
        state.pin = '';
        renderDots();

        var o = document.getElementById(OVERLAY_ID);
        if (o) {
            o.classList.add('qp-shake');
            setTimeout(function () { o.classList.remove('qp-shake'); }, 400);
        }

        if (status === 429) {
            var s = err && err.RetryAfterSeconds ? err.RetryAfterSeconds : 60;
            startCountdown(s);
        } else if (status === 0) {
            setMsg('Serveur injoignable.');
        } else {
            setMsg((err && err.Message) || 'Code PIN incorrect.');
        }
    }

    function startCountdown(seconds) {
        var left = seconds;
        setMsg('Trop d\u2019essais. Patientez ' + left + ' s…');
        var t = setInterval(function () {
            left -= 1;
            if (!state || state.view !== 'pin') { clearInterval(t); return; }
            if (left <= 0) {
                clearInterval(t);
                setMsg('');
            } else {
                setMsg('Trop d\u2019essais. Patientez ' + left + ' s…');
            }
        }, 1000);
    }

    /* --------------------------- Succès -------------------------------- */

    function onSuccess(result) {
        if (!result || !result.AccessToken) {
            onFailure(0, {});
            return;
        }

        try { saveCredentials(result); } catch (e) { /* on tente quand même */ }
        try { localStorage.setItem('enableAutoLogin', 'true'); } catch (e) { /* ignore */ }
        try { sessionStorage.removeItem(SKIP_KEY); } catch (e) { /* ignore */ }

        window.location.hash = '#/home.html';
        window.location.reload();
    }

    function saveCredentials(result) {
        var raw = null;
        try { raw = localStorage.getItem('jellyfin_credentials'); } catch (e) { /* ignore */ }

        var creds;
        try { creds = raw ? JSON.parse(raw) : null; } catch (e) { creds = null; }
        if (!creds || typeof creds !== 'object') { creds = {}; }
        if (!creds.Servers || !creds.Servers.length) { creds.Servers = []; }

        var server = null;
        if (result.ServerId) {
            for (var i = 0; i < creds.Servers.length; i++) {
                if (creds.Servers[i].Id === result.ServerId) { server = creds.Servers[i]; break; }
            }
        }
        if (!server) { server = creds.Servers.length ? creds.Servers[0] : null; }
        if (!server) {
            server = { Id: result.ServerId || randomId(), ManualAddress: state.base };
            creds.Servers.push(server);
        }

        server.Id = result.ServerId || server.Id;
        server.AccessToken = result.AccessToken;
        server.UserId = result.User && result.User.Id ? result.User.Id : server.UserId;
        server.DateLastAccessed = new Date().toISOString();
        if (!server.ManualAddress && !server.LocalAddress && !server.RemoteAddress) {
            server.ManualAddress = state.base;
        }

        localStorage.setItem('jellyfin_credentials', JSON.stringify(creds));
    }

    /* --------------------------- Clavier / D-pad ----------------------- */

    function setFocus(i) {
        if (!state || !state.focusables.length) { return; }
        var n = state.focusables.length;
        i = Math.max(0, Math.min(i, n - 1));
        for (var j = 0; j < n; j++) {
            state.focusables[j].classList.toggle('qp-focus', j === i);
        }
        state.focusIndex = i;
        try { state.focusables[i].focus({ preventScroll: true }); } catch (e) {
            try { state.focusables[i].focus(); } catch (e2) { /* ignore */ }
        }
    }

    function onKeyDown(ev) {
        if (!state || !document.getElementById(OVERLAY_ID)) { return; }

        var code = ev.keyCode || ev.which;
        var handled = true;

        // Chiffres directs (rangée du haut 48-57, pavé numérique 96-105)
        if (code >= 48 && code <= 57) {
            handleDigit(String(code - 48));
        } else if (code >= 96 && code <= 105) {
            handleDigit(String(code - 96));
        } else if (code === 37) { move(-1, 0); }          // gauche
        else if (code === 39) { move(1, 0); }             // droite
        else if (code === 38) { move(0, -1); }            // haut
        else if (code === 40) { move(0, 1); }             // bas
        else if (code === 13) {                           // OK / Enter
            var el = state.focusables[state.focusIndex];
            if (el) { el.click(); }
        } else if (code === 8) {                          // effacer
            if (state.view === 'pin') { pressKey('del'); } else { handled = false; }
        } else if (code === 27 || code === 10009 || code === 461) { // Esc / back Tizen / back webOS
            if (state.view === 'pin') { renderProfiles(); }
            else if (state.data.ShowClassicLoginLink) { classicLogin(); }
        } else {
            handled = false;
        }

        if (handled) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    }

    function handleDigit(d) {
        if (state.view === 'pin') {
            addDigit(d);
        } else if (state.view === 'profiles') {
            var idx = parseInt(d, 10) - 1;
            if (idx >= 0 && idx < state.data.Profiles.length) {
                selectProfile(state.data.Profiles[idx]);
            }
        }
    }

    function move(dx, dy) {
        if (!state) { return; }
        var i = state.focusIndex;
        var n = state.focusables.length;

        if (state.view === 'profiles') {
            var profileCount = state.data.Profiles.length;
            var hasLink = state.data.ShowClassicLoginLink;
            if (dx !== 0) {
                if (i < profileCount) { setFocus(clamp(i + dx, 0, profileCount - 1)); }
            } else if (dy > 0 && hasLink && i < profileCount) {
                setFocus(n - 1); // descendre vers le lien
            } else if (dy < 0 && hasLink && i === n - 1) {
                setFocus(0); // remonter vers les profils
            }
            return;
        }

        // Vue PIN : grille 3 colonnes, 4 rangées [1-9, del, 0, back]
        if (dx !== 0) {
            var col = i % 3;
            var target = i + dx;
            if ((dx < 0 && col > 0) || (dx > 0 && col < 2)) { setFocus(target); }
        } else if (dy !== 0) {
            var target2 = i + dy * 3;
            if (target2 >= 0 && target2 < n) { setFocus(target2); }
        }
    }

    function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }
})();
