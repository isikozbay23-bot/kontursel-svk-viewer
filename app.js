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

// Fotoğraf bölümü için bekleyen ref/liste (PIN girilince kullanılır)
let _pendingFoto = null;

function loadFotolar(ref, fotoList) {
    const proxyUrl = window.SVK_PROXY || '';
    const fotoSection = document.getElementById('foto-section');

    if (!proxyUrl || !fotoList.length) {
        fotoSection.classList.add('hidden');
        return;
    }

    fotoSection.classList.remove('hidden');
    const pin = sessionStorage.getItem('svk-pin') || '';

    if (!pin) {
        // PIN henüz girilmemiş — kilit ekranı göster
        _showFotoKilit(ref, fotoList, fotoSection);
        return;
    }

    _renderFotolar(ref, fotoList, pin, fotoSection);
}

function _showFotoKilit(ref, fotoList, fotoSection) {
    _pendingFoto = { ref, fotoList };
    const container = document.getElementById('foto-container');
    container.className = 'foto-container single';
    container.innerHTML = `
        <div class="foto-item foto-kilit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="5" y="11" width="14" height="10" rx="2"/>
                <path stroke-linecap="round" d="M8 11V7a4 4 0 018 0v4"/>
            </svg>
            <p>${fotoList.length} paket fotoğrafı</p>
            <button class="btn-foto-ac" onclick="fotoKilitAc()">PIN ile Görüntüle</button>
        </div>`;
}

function fotoKilitAc() {
    if (!_pendingFoto) return;
    // Mevcut PIN modal'ını fotoğraf için aç
    _pendingDownload = null; // download modunda değil
    openPinModal();
    // PIN confirm'i override et — fotoğraf yükleme için
    document._svkFotoMode = true;
}

function _renderFotolar(ref, fotoList, pin, fotoSection) {
    const container = document.getElementById('foto-container');
    const isSingle = fotoList.length === 1;
    container.className = `foto-container${isSingle ? ' single' : ''}`;
    container.innerHTML = '';

    fotoList.forEach(fotoAdi => {
        const fotoUrl = `${window.SVK_PROXY}/foto/${encodeURIComponent(ref)}/${encodeURIComponent(fotoAdi)}?pin=${encodeURIComponent(pin)}`;

        const item = document.createElement('div');
        item.className = 'foto-item';

        const skel = document.createElement('div');
        skel.className = 'foto-skeleton';
        skel.innerHTML = '<div class="skeleton-shimmer"></div>';

        const img = document.createElement('img');
        img.className = 'paket-foto hidden';
        img.alt = 'Paket fotoğrafı';

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

        item.appendChild(skel);
        item.appendChild(img);
        item.appendChild(err);
        container.appendChild(item);
        // iOS Safari: img.src DOM'a eklendikten sonra set edilmeli
        img.src = fotoUrl;
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

    // Session'da PIN var mı? — Varsa hemen aç (kullanıcı hareketi bağlamı korunur)
    const pin = sessionStorage.getItem('svk-pin');
    if (pin) {
        const directUrl = `${proxyUrl}/dl/${encodeURIComponent(ref)}/${encodeURIComponent(dosya)}?pin=${encodeURIComponent(pin)}`;
        window.open(directUrl, '_blank');
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

    // Fotoğraf kilit açma modu
    if (document._svkFotoMode) {
        document._svkFotoMode = false;
        closePinModal();
        if (_pendingFoto) {
            const fotoSection = document.getElementById('foto-section');
            // Önce PIN doğruluğunu kontrol et (dummy foto isteği)
            const { ref, fotoList } = _pendingFoto;
            _pendingFoto = null;
            sessionStorage.setItem('svk-pin', pin);
            _renderFotolar(ref, fotoList, pin, fotoSection);
        }
        return;
    }

    if (!_pendingDownload) {
        closePinModal();
        return;
    }

    const { ref, dosya } = _pendingDownload;
    const proxyUrl = window.SVK_PROXY || '';

    if (proxyUrl) {
        // window.open await'ten ÖNCE çağrılmalı — iOS Safari kullanıcı hareketi bağlamı
        const directUrl = `${proxyUrl}/dl/${encodeURIComponent(ref)}/${encodeURIComponent(dosya)}?pin=${encodeURIComponent(pin)}`;
        window.open(directUrl, '_blank');
        sessionStorage.setItem('svk-pin', pin);
    }

    closePinModal();
    _pendingDownload = null;
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
    try {
        const manifest = parseManifest();
        // Proxy URL'yi QR verisinden oku
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
