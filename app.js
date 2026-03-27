/**
 * app.js — Kontur-SEL Sevkiyat Viewer
 *
 * URL formatı: <viewer>/p/<REF>#<LZString_sıkıştırılmış_JSON>
 *
 * Compact JSON alanları:
 *   v=versiyon (1|2), r=ref, s=santiye, t=tarih, h=hazirlayan
 *   pf=paket_foto (v1 uyumluluk), pfs=foto_listesi (v2), n=not, n2=not2 (v2)
 *   k=kalemler: [{p=poz, a=ad, m=miktar, b=birim, d=dosyalar}]
 *   dosya: {a=dosya_adi, t=tip_k(tc|f|bl), by=boyut}
 *
 * Proxy URL: window.SVK_PROXY (index.html içinde tanımlıdır)
 *   - LAN modu : 'http://192.168.x.x:5555/api/svk-dosya'
 *   - Cloudflare: 'https://kontursel-dl.xxx.workers.dev'
 *   - Boş string: dosya indirme devre dışı
 */

'use strict';

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────

function esc(s) {
    if (!s && s !== 0) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function tipLabel(tipK) {
    const map = { tc: 'Çizim', f: 'Foto', bl: 'Belge' };
    return map[tipK] || 'İndir';
}

function tipIcon(tipK) {
    if (tipK === 'tc') {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" d="M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v5"/>
            <polyline stroke-linecap="round" points="17 21 21 21 21 17"/>
            <line x1="13" y1="21" x2="21" y2="13"/>
        </svg>`;
    }
    if (tipK === 'f') {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5l5 5v11a2 2 0 01-2 2z"/>
    </svg>`;
}

// ── Tema yönetimi ──────────────────────────────────────────────────────────

function initTheme() {
    const saved = localStorage.getItem('svk-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);

    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('svk-theme', next);
    });
}

// ── Görünüm geçişleri ──────────────────────────────────────────────────────

function showState(name) {
    ['loading', 'error', 'content'].forEach(s => {
        const el = document.getElementById(`state-${s}`);
        el.classList.toggle('hidden', s !== name);
    });
}

function showError(msg) {
    document.getElementById('error-message').textContent = msg;
    showState('error');
}

// ── URL parse ──────────────────────────────────────────────────────────────

function parseManifest() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) {
        throw new Error('QR verisinde hash fragment bulunamadı.');
    }

    const compressed = hash.slice(1); // # karakterini atla
    if (!compressed) {
        throw new Error('QR verisi boş.');
    }

    let decompressed;
    try {
        decompressed = LZString.decompressFromEncodedURIComponent(compressed);
    } catch (e) {
        throw new Error('Veri sıkıştırma çözme hatası: ' + e.message);
    }

    if (!decompressed) {
        throw new Error('LZString decode başarısız — geçersiz veya bozuk QR.');
    }

    let manifest;
    try {
        manifest = JSON.parse(decompressed);
    } catch (e) {
        throw new Error('JSON parse hatası — QR verisi bozuk.');
    }

    if (!manifest || ![1, 2].includes(manifest.v)) {
        throw new Error('Desteklenmeyen manifest versiyonu.');
    }
    if (!manifest.r || !manifest.s) {
        throw new Error('Gerekli manifest alanları eksik.');
    }

    return manifest;
}

// ── Sayfa render ───────────────────────────────────────────────────────────

function renderPage(manifest) {
    // Başlık kartı
    document.getElementById('paket-ref').textContent = manifest.r;
    document.getElementById('paket-santiye').textContent = manifest.s;
    document.getElementById('paket-tarih').textContent = formatDate(manifest.t);
    document.getElementById('paket-hazirlayan').textContent = manifest.h || '';

    // Sayfa başlığını güncelle
    document.title = `${manifest.r} — ${manifest.s}`;

    // Not 1
    const notWrap = document.getElementById('paket-not-wrap');
    if (manifest.n) {
        document.getElementById('paket-not').textContent = manifest.n;
        notWrap.classList.remove('hidden');
    } else {
        notWrap.classList.add('hidden');
    }

    // Not 2 (v2)
    const not2Wrap = document.getElementById('paket-not2-wrap');
    if (manifest.n2) {
        document.getElementById('paket-not2').textContent = manifest.n2;
        not2Wrap.classList.remove('hidden');
    } else {
        not2Wrap.classList.add('hidden');
    }

    // Fotoğraflar
    const fotoList = manifest.pfs || (manifest.pf ? [manifest.pf] : []);
    if (fotoList.length > 0) {
        loadFotolar(manifest.r, fotoList);
    }

    // Kalemler
    const kalemler = manifest.k || [];
    document.getElementById('kalem-count').textContent = `${kalemler.length} kalem`;
    renderKalemler(kalemler, manifest.r);

    // Footer
    document.getElementById('footer-ref').textContent = manifest.r;

    showState('content');
}

// ── Fotoğraf yükleme (çoklu) ──────────────────────────────────────────────

function loadFotolar(ref, fotoList) {
    const proxyUrl = window.SVK_PROXY || '';
    const fotoSection = document.getElementById('foto-section');
    const container = document.getElementById('foto-container');

    if (!proxyUrl || !fotoList.length) {
        fotoSection.classList.add('hidden');
        return;
    }

    fotoSection.classList.remove('hidden');
    const pin = sessionStorage.getItem('svk-pin') || '';
    const isSingle = fotoList.length === 1;
    container.className = `foto-container${isSingle ? ' single' : ''}`;
    container.innerHTML = '';

    fotoList.forEach(fotoAdi => {
        const fotoUrl = `${proxyUrl}/foto/${encodeURIComponent(ref)}/${encodeURIComponent(fotoAdi)}${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`;

        const item = document.createElement('div');
        item.className = 'foto-item';

        const skel = document.createElement('div');
        skel.className = 'foto-skeleton';
        skel.innerHTML = '<div class="skeleton-shimmer"></div>';

        const img = document.createElement('img');
        img.className = 'paket-foto hidden';
        img.alt = 'Paket fotoğrafı';
        img.loading = 'lazy';
        img.decoding = 'async';

        const err = document.createElement('div');
        err.className = 'foto-error hidden';
        err.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg><span>Fotoğraf yüklenemedi</span>`;

        img.onload = () => {
            skel.classList.add('hidden');
            err.classList.add('hidden');
            img.classList.remove('hidden');
        };
        img.onerror = () => {
            skel.classList.add('hidden');
            img.classList.add('hidden');
            err.classList.remove('hidden');
        };
        img.src = fotoUrl;

        item.appendChild(skel);
        item.appendChild(img);
        item.appendChild(err);
        container.appendChild(item);
    });
}

// ── Kalem listesi ──────────────────────────────────────────────────────────

function renderKalemler(kalemler, ref) {
    const ct = document.getElementById('kalem-list');
    if (!kalemler.length) {
        ct.innerHTML = '<p style="color:var(--text-faint);font-size:0.9rem;text-align:center;padding:32px">Kalem bulunamadı.</p>';
        return;
    }

    ct.innerHTML = kalemler.map((k, i) => {
        const dosyalar = k.d || [];
        const hasDosya = dosyalar.length > 0;
        const proxyUrl = window.SVK_PROXY || '';

        return `
        <div class="kalem-item">
            <div class="kalem-left">
                <div class="kalem-poz">${esc(k.p)}</div>
                <div class="kalem-ad">${esc(k.a)}</div>
                <div class="kalem-miktar">
                    <strong>${esc(k.m)}</strong>
                    <span>${esc(k.b)}</span>
                </div>
            </div>
            ${hasDosya ? `
            <div class="kalem-right">
                <div class="kalem-dosyalar">
                    ${dosyalar.map((d, di) => `
                    <div>
                        <button class="btn-indir tip-${esc(d.t)}"
                            data-ref="${esc(ref)}"
                            data-dosya="${esc(d.a)}"
                            data-tip="${esc(d.t)}"
                            ${!proxyUrl ? 'disabled title="Dosya indirme henüz yapılandırılmadı"' : ''}
                            onclick="handleIndir(this)">
                            ${tipIcon(d.t)}
                            ${tipLabel(d.t)}
                        </button>
                        ${d.by ? `<div class="dosya-boyut">${formatFileSize(d.by)}</div>` : ''}
                    </div>
                    `).join('')}
                </div>
            </div>` : ''}
        </div>`;
    }).join('');
}

// ── Dosya indirme ──────────────────────────────────────────────────────────

let _pendingDownload = null; // { btn, ref, dosya } — PIN modal beklerken

function handleIndir(btn) {
    const ref = btn.dataset.ref;
    const dosya = btn.dataset.dosya;
    const proxyUrl = window.SVK_PROXY || '';

    if (!proxyUrl) {
        alert('Dosya indirme henüz yapılandırılmadı.\nLütfen fabrika ile iletişime geçin.');
        return;
    }

    // Session'da PIN var mı?
    const pin = sessionStorage.getItem('svk-pin');
    if (pin) {
        doDownload(btn, ref, dosya, pin);
        return;
    }

    // PIN modal aç
    _pendingDownload = { btn, ref, dosya };
    openPinModal();
}

function openPinModal() {
    const modal = document.getElementById('pin-modal');
    const input = document.getElementById('pin-input');
    const errEl = document.getElementById('pin-error');
    input.value = '';
    errEl.classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
}

function closePinModal() {
    document.getElementById('pin-modal').classList.add('hidden');
    _pendingDownload = null;
}

async function confirmPin() {
    const pin = document.getElementById('pin-input').value.trim();
    const errEl = document.getElementById('pin-error');

    if (!pin) {
        errEl.textContent = 'PIN girilmedi.';
        errEl.classList.remove('hidden');
        return;
    }

    errEl.classList.add('hidden');

    if (!_pendingDownload) {
        closePinModal();
        return;
    }

    const { btn, ref, dosya } = _pendingDownload;
    closePinModal();

    const ok = await doDownload(btn, ref, dosya, pin);
    if (ok) {
        sessionStorage.setItem('svk-pin', pin);
    }
}

async function doDownload(btn, ref, dosya, pin) {
    const proxyUrl = window.SVK_PROXY || '';
    if (!proxyUrl) return false;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        // POST /download endpoint (Cloudflare Worker format)
        const resp = await fetch(`${proxyUrl}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pin,
                ref,
                dosya,
            }),
        });

        if (resp.status === 401) {
            // PIN hatalı
            sessionStorage.removeItem('svk-pin');
            _pendingDownload = { btn, ref, dosya };
            const errEl = document.getElementById('pin-error');
            errEl.textContent = 'Hatalı PIN. Tekrar deneyin.';
            errEl.classList.remove('hidden');
            openPinModal();
            return false;
        }

        if (!resp.ok) {
            alert(`Dosya indirilemedi (${resp.status}). Lütfen tekrar deneyin.`);
            return false;
        }

        // Dosyayı indir
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = dosya;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;

    } catch (err) {
        alert('Bağlantı hatası. İnternet bağlantınızı kontrol edin.');
        return false;
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// ── PIN Modal event listeners ───────────────────────────────────────────────

document.getElementById('pin-confirm').addEventListener('click', confirmPin);
document.getElementById('pin-cancel').addEventListener('click', closePinModal);
document.getElementById('pin-modal-close').addEventListener('click', closePinModal);

document.getElementById('pin-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmPin();
    if (e.key === 'Escape') closePinModal();
});

// Modal dışına tıklama
document.getElementById('pin-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('pin-modal')) closePinModal();
});

// ── Ana giriş noktası ──────────────────────────────────────────────────────

function init() {
    initTheme();

    try {
        const manifest = parseManifest();
        // Proxy URL'yi QR verisinden oku (index.html'deki sabit config'e göre önceliklidir)
        if (manifest.px) {
            window.SVK_PROXY = manifest.px;
        }
        renderPage(manifest);
    } catch (err) {
        showError(err.message || 'Bilinmeyen hata oluştu.');
    }
}

// DOM hazır olduğunda başlat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
