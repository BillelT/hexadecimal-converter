(function () {
  'use strict';

  /* ========================================================================
     CONVERTER — bases numériques + texte UTF-8
     ===================================================================== */

  const BASES = {
    '16': { id: 'hexInput', re: /^[0-9a-fA-F]*$/, group: 2 },
    '10': { id: 'decInput', re: /^[0-9]*$/,        group: 0 },
    '8':  { id: 'octInput', re: /^[0-7]*$/,        group: 0 },
    '2':  { id: 'binInput', re: /^[01]*$/,         group: 4 },
  };

  const inputs = {};
  for (const b in BASES) inputs[b] = document.getElementById(BASES[b].id);

  const textInput = document.getElementById('textInput');
  const errorMsg = document.getElementById('errorMsg');

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function group(str, size) {
    if (!size) return str;
    const clean = str.replace(/\s+/g, '');
    const parts = [];
    for (let i = clean.length; i > 0; i -= size) {
      parts.unshift(clean.slice(Math.max(0, i - size), i));
    }
    return parts.join(' ');
  }

  function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function hexToBytes(hex) {
    const clean = hex.replace(/\s+/g, '');
    const padded = clean.length % 2 === 0 ? clean : '0' + clean;
    const out = new Uint8Array(padded.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function setError(msg) {
    if (msg) {
      errorMsg.textContent = msg;
      errorMsg.hidden = false;
    } else {
      errorMsg.textContent = '';
      errorMsg.hidden = true;
    }
  }

  function syncFromHex(hex, except) {
    if (inputs['16'] !== except) inputs['16'].value = group(hex, BASES['16'].group);

    if (!hex) {
      for (const b of ['10', '8', '2']) if (inputs[b] !== except) inputs[b].value = '';
      if (textInput !== except) textInput.value = '';
      return;
    }

    const big = BigInt('0x' + hex);
    for (const b of ['10', '8', '2']) {
      if (inputs[b] === except) continue;
      inputs[b].value = group(big.toString(Number(b)), BASES[b].group);
    }

    if (textInput !== except) {
      try { textInput.value = decoder.decode(hexToBytes(hex)); }
      catch { textInput.value = ''; }
    }
  }

  function onNumberInput(base, el) {
    const cfg = BASES[base];
    const raw = el.value.replace(/\s+/g, '');
    const value = base === '16' ? raw.toLowerCase() : raw;

    if (!value) {
      setError('');
      syncFromHex('', el);
      return;
    }

    if (!cfg.re.test(value)) {
      setError('Invalid character for base ' + base + '.');
      return;
    }

    setError('');
    const prefix = base === '16' ? '0x' : base === '8' ? '0o' : base === '2' ? '0b' : '';
    const big = BigInt(prefix + value);
    let hex = big.toString(16);
    if (base === '16' && value.length > hex.length) hex = value;
    syncFromHex(hex, el);
  }

  function onTextInput() {
    const txt = textInput.value;
    setError('');
    if (!txt) { syncFromHex('', textInput); return; }
    syncFromHex(bytesToHex(encoder.encode(txt)), textInput);
  }

  for (const b in inputs) {
    (function (base, el) {
      el.addEventListener('input', function () { onNumberInput(base, el); });
    })(b, inputs[b]);
  }
  textInput.addEventListener('input', onTextInput);

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const target = document.getElementById(btn.dataset.copy);
      if (!target || !target.value) return;
      const raw = target === textInput ? target.value : target.value.replace(/\s+/g, '');
      navigator.clipboard.writeText(raw).then(function () {
        const orig = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = orig; }, 1200);
      }).catch(function () { target.select(); });
    });
  });

  /* ========================================================================
     FILE INSPECTOR — hex/ASCII dump façon xxd
     ===================================================================== */

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileNameEl = document.getElementById('fileName');
  const fileSizeEl = document.getElementById('fileSize');
  const hexDumpEl = document.getElementById('hexDump');
  const pagerEl = document.getElementById('filePager');
  const pagerPrev = document.getElementById('pagerPrev');
  const pagerNext = document.getElementById('pagerNext');
  const pagerStatus = document.getElementById('pagerStatus');
  const dumpFormatBtn = document.getElementById('dumpFormat');
  const dumpCopyBtn = document.getElementById('dumpCopy');
  const dumpDownloadBtn = document.getElementById('dumpDownload');
  const dumpClearBtn = document.getElementById('dumpClear');

  const PAGE_SIZE = 4096;
  const ROW = 16;

  let loaded = null;     /* { name, size, bytes } */
  let page = 0;

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function ascii(b) {
    return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
  }

  function renderSlice(bytes, start, length) {
    const end = Math.min(bytes.length, start + length);
    const lines = [];
    for (let i = start; i < end; i += ROW) {
      const rowEnd = Math.min(end, i + ROW);
      let hex = '';
      let txt = '';
      for (let j = i; j < rowEnd; j++) {
        hex += bytes[j].toString(16).padStart(2, '0');
        hex += j === i + 7 ? '  ' : ' ';
        txt += ascii(bytes[j]);
      }
      const padTo = ROW * 3 + 1;
      if (hex.length < padTo) hex += ' '.repeat(padTo - hex.length);
      lines.push(i.toString(16).padStart(8, '0') + '  ' + hex + ' ' + txt);
    }
    return lines.join('\n');
  }

  function renderPage() {
    if (!loaded) return;
    const start = page * PAGE_SIZE;
    const end = Math.min(loaded.size, start + PAGE_SIZE);
    hexDumpEl.value = renderSlice(loaded.bytes, start, PAGE_SIZE);

    const total = Math.ceil(loaded.size / PAGE_SIZE);
    if (total > 1) {
      pagerEl.hidden = false;
      pagerStatus.textContent =
        '0x' + start.toString(16).padStart(8, '0') +
        ' – 0x' + (end - 1).toString(16).padStart(8, '0') +
        '  ·  page ' + (page + 1) + ' / ' + total;
    } else {
      pagerEl.hidden = true;
    }
    hexDumpEl.scrollTop = 0;
  }

  /* Parse l'éditable : pour chaque ligne, saute l'offset (8 chars + 2 spaces),
     prend la colonne hex (49 chars max), ignore l'ASCII. Extrait les paires
     hex valides — tout reste robuste si l'utilisateur édite librement. */
  function parseDumpText(text) {
    const out = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (!line.trim()) continue;

      /* Si la ligne commence par un offset (6+ chars hex puis 2 espaces),
         on le skip. Sinon on parse depuis le début. */
      if (/^[0-9a-fA-F]{6,8}\s{2}/.test(line)) {
        line = line.slice(line.match(/^[0-9a-fA-F]{6,8}\s{2}/)[0].length);
      }

      /* La colonne hex fait au max 49 chars : 16 paires + 15 espaces + 1 supp. */
      const hexCol = line.slice(0, 49);
      const pairs = hexCol.match(/[0-9a-fA-F]{2}/g);
      if (pairs) {
        for (let j = 0; j < pairs.length; j++) out.push(parseInt(pairs[j], 16));
      }
    }
    return new Uint8Array(out);
  }

  /* Reconstruit loaded.bytes en remplaçant la page courante par les
     bytes parsés depuis le textarea. La page peut grandir ou rétrécir. */
  function commitEdits() {
    if (!loaded) return;
    const start = page * PAGE_SIZE;
    const oldEnd = Math.min(loaded.size, start + PAGE_SIZE);
    const oldLen = oldEnd - start;
    const parsed = parseDumpText(hexDumpEl.value);

    /* Pas de changement → skip */
    if (parsed.length === oldLen) {
      let identical = true;
      for (let i = 0; i < oldLen; i++) {
        if (loaded.bytes[start + i] !== parsed[i]) { identical = false; break; }
      }
      if (identical) return;
    }

    const before = loaded.bytes.subarray(0, start);
    const after = loaded.bytes.subarray(start + oldLen);
    const merged = new Uint8Array(before.length + parsed.length + after.length);
    merged.set(before, 0);
    merged.set(parsed, before.length);
    merged.set(after, before.length + parsed.length);
    loaded.bytes = merged;
    loaded.size = merged.length;
    fileSizeEl.textContent = fmtSize(loaded.size) + ' · ' + loaded.size + ' bytes · edited';
  }

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const bytes = new Uint8Array(e.target.result);
      loaded = { name: file.name, size: bytes.length, bytes: bytes };
      page = 0;
      fileNameEl.textContent = file.name;
      fileSizeEl.textContent = fmtSize(bytes.length) + ' · ' + bytes.length + ' bytes';
      renderPage();
    };
    reader.onerror = function () {
      setError('Could not read the file.');
    };
    reader.readAsArrayBuffer(file);
  }

  function clearFile() {
    loaded = null;
    page = 0;
    fileInput.value = '';
    fileNameEl.textContent = 'No file loaded';
    fileSizeEl.textContent = '';
    hexDumpEl.value = '';
    pagerEl.hidden = true;
  }

  fileInput.addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
  });

  /* Plus de bouton dédié : toute la zone ouvre le sélecteur de fichier. */
  dropzone.addEventListener('click', function () {
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
    });
  });

  dropzone.addEventListener('drop', function (e) {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  /* Édition en direct : on commit (parse + splice) sur chaque input,
     debouncé, pour garder loaded.bytes et la taille à jour SANS re-render
     (sinon le curseur saute). Le formatage propre se fait via "Reformater". */
  let commitTimer = null;
  hexDumpEl.addEventListener('input', function () {
    if (!loaded) return;
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitEdits, 200);
  });
  hexDumpEl.addEventListener('blur', function () {
    clearTimeout(commitTimer);
    commitEdits();
  });

  pagerPrev.addEventListener('click', function () {
    if (page > 0) { commitEdits(); page--; renderPage(); }
  });
  pagerNext.addEventListener('click', function () {
    commitEdits();
    const total = Math.ceil((loaded ? loaded.size : 0) / PAGE_SIZE);
    if (page < total - 1) { page++; renderPage(); }
  });

  dumpFormatBtn.addEventListener('click', function () {
    if (!loaded) return;
    commitEdits();
    renderPage();
  });

  dumpCopyBtn.addEventListener('click', function () {
    if (!loaded) return;
    commitEdits();
    const hex = bytesToHex(loaded.bytes);
    navigator.clipboard.writeText(hex).then(function () {
      const orig = dumpCopyBtn.textContent;
      dumpCopyBtn.textContent = 'Copied';
      setTimeout(function () { dumpCopyBtn.textContent = orig; }, 1500);
    }).catch(function () {
      setError('Clipboard copy was blocked by the browser.');
    });
  });

  dumpDownloadBtn.addEventListener('click', function () {
    if (!loaded) return;
    commitEdits();
    /* Téléchargement du fichier binaire modifié, pas du hex texte */
    const blob = new Blob([loaded.bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = loaded.name.replace(/(\.[^.]+)?$/, '.edited$1');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  dumpClearBtn.addEventListener('click', clearFile);

  /* Empêche le navigateur d'ouvrir le fichier si on le drop hors zone */
  ['dragover', 'drop'].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (!dropzone.contains(e.target)) e.preventDefault();
    });
  });

  /* ========================================================================
     SOUND — feedback sonore d'interface (b-audio · @web-kits/audio)
     Actif par défaut, opt-out via le toggle du footer. Reduced-motion ⇒
     démarre coupé. Contexte audio débloqué au 1er geste seulement.
     ===================================================================== */

  const soundToggle = document.getElementById('sound-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let soundOn = !reducedMotion;
  soundToggle.checked = soundOn;
  soundToggle.disabled = reducedMotion;
  soundToggle.addEventListener('change', function () {
    soundOn = soundToggle.checked && !reducedMotion;
  });

  let palettePromise = null;
  let audioUnlocked = false;

  /* Chargement paresseux — la lib n'est importée qu'au premier geste sonore. */
  function loadPalette() {
    if (!palettePromise) {
      palettePromise = import('https://esm.sh/@web-kits/audio@0.1.0').then(function (mod) {
        const defineSound = mod.defineSound;
        const defineSequence = mod.defineSequence;

        /* Reformater : blip de bascule de mode (schéma "tab" du DS) */
        const playReformat = defineSound({
          source: { type: 'sine', frequency: 880 },
          envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
          gain: 0.18,
        });

        /* Copier / Télécharger : deux notes montantes (succès / export) */
        const copyA = defineSound({
          source: { type: 'sine', frequency: 880 },
          envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
          gain: 0.18,
        });
        const copyB = defineSound({
          source: { type: 'sine', frequency: 1320 },
          envelope: { attack: 0.001, decay: 0.10, sustain: 0, release: 0.05 },
          gain: 0.20,
        });
        const playCopy = defineSequence([{ sound: copyA, at: 0 }, { sound: copyB, at: 0.08 }]);

        /* Reset / Vider : glissando descendant */
        const playReset = defineSound({
          source: { type: 'sine', frequency: { start: 800, end: 200 } },
          envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.05 },
          gain: 0.16,
        });

        return {
          playReformat: playReformat,
          playCopy: playCopy,
          playReset: playReset,
          ensureReady: mod.ensureReady,
        };
      });
    }
    return palettePromise;
  }

  /* Garde unique : rien ne joue tant que le toggle est OFF ; le 1er geste
     débloque le contexte (politique d'autoplay des navigateurs). */
  function feedback(pick) {
    if (!soundOn) return;
    loadPalette().then(function (palette) {
      const unlock = audioUnlocked ? Promise.resolve() : palette.ensureReady().then(function () { audioUnlocked = true; });
      unlock.then(function () { pick(palette)(); });
    }).catch(function () { /* lib injoignable → pas de son, le reste de l'outil continue */ });
  }

  /* Branchement, sélectif — sliders/pager restent muets, comme sur boids */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () { feedback(function (p) { return p.playCopy; }); });
  });
  dumpCopyBtn.addEventListener('click', function () { feedback(function (p) { return p.playCopy; }); });
  dumpDownloadBtn.addEventListener('click', function () { feedback(function (p) { return p.playCopy; }); });
  dumpClearBtn.addEventListener('click', function () { feedback(function (p) { return p.playReset; }); });
  dumpFormatBtn.addEventListener('click', function () { feedback(function (p) { return p.playReformat; }); });
})();
