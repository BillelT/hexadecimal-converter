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
  const resetBtn = document.getElementById('resetBtn');

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
      setError('Caractère non valide pour la base ' + base + '.');
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
        btn.textContent = 'Copié';
        setTimeout(function () { btn.textContent = orig; }, 1200);
      }).catch(function () { target.select(); });
    });
  });

  resetBtn.addEventListener('click', function () {
    for (const b in inputs) inputs[b].value = '';
    textInput.value = '';
    setError('');
    clearFile();
  });

  /* ========================================================================
     FILE INSPECTOR — hex/ASCII dump façon xxd
     ===================================================================== */

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileView = document.getElementById('fileView');
  const fileNameEl = document.getElementById('fileName');
  const fileSizeEl = document.getElementById('fileSize');
  const hexDumpEl = document.getElementById('hexDump');
  const pagerEl = document.getElementById('filePager');
  const pagerPrev = document.getElementById('pagerPrev');
  const pagerNext = document.getElementById('pagerNext');
  const pagerStatus = document.getElementById('pagerStatus');
  const dumpCopyBtn = document.getElementById('dumpCopy');
  const dumpDownloadBtn = document.getElementById('dumpDownload');
  const dumpClearBtn = document.getElementById('dumpClear');

  const PAGE_SIZE = 4096;
  const ROW = 16;

  let loaded = null;     /* { name, size, bytes } */
  let page = 0;

  function fmtSize(n) {
    if (n < 1024) return n + ' o';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' Ko';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' Mo';
    return (n / 1073741824).toFixed(2) + ' Go';
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
    hexDumpEl.textContent = renderSlice(loaded.bytes, start, PAGE_SIZE);

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

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const bytes = new Uint8Array(e.target.result);
      loaded = { name: file.name, size: bytes.length, bytes: bytes };
      page = 0;
      fileNameEl.textContent = file.name;
      fileSizeEl.textContent = fmtSize(bytes.length) + ' · ' + bytes.length + ' octets';
      fileView.hidden = false;
      renderPage();
    };
    reader.onerror = function () {
      setError('Lecture du fichier impossible.');
    };
    reader.readAsArrayBuffer(file);
  }

  function clearFile() {
    loaded = null;
    page = 0;
    fileInput.value = '';
    fileView.hidden = true;
    hexDumpEl.textContent = '';
  }

  fileInput.addEventListener('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
  });

  dropzone.addEventListener('click', function (e) {
    if (e.target === dropzone || e.target.classList.contains('dropzone__inner') || e.target.classList.contains('dropzone__title')) {
      fileInput.click();
    }
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

  pagerPrev.addEventListener('click', function () {
    if (page > 0) { page--; renderPage(); }
  });
  pagerNext.addEventListener('click', function () {
    const total = Math.ceil((loaded ? loaded.size : 0) / PAGE_SIZE);
    if (page < total - 1) { page++; renderPage(); }
  });

  dumpCopyBtn.addEventListener('click', function () {
    if (!loaded) return;
    const hex = bytesToHex(loaded.bytes);
    navigator.clipboard.writeText(hex).then(function () {
      const orig = dumpCopyBtn.textContent;
      dumpCopyBtn.textContent = 'Copié';
      setTimeout(function () { dumpCopyBtn.textContent = orig; }, 1500);
    }).catch(function () {
      setError('Copie refusée par le navigateur.');
    });
  });

  dumpDownloadBtn.addEventListener('click', function () {
    if (!loaded) return;
    const hex = bytesToHex(loaded.bytes);
    const blob = new Blob([hex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = loaded.name + '.hex.txt';
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
})();
