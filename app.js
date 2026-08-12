/* ============================================
   音乐教学演示台 v4 — 浅色主题 + 多图 + 图片放大 + B站视频
   数据存储：Supabase (PostgreSQL + Storage)
   ============================================ */

// ====== Supabase 配置 ======
const SUPABASE_URL = 'https://dgffaxdaorwzsqyrkfxd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZmZheGRhb3J3enNxeXJrZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTcwOTYsImV4cCI6MjEwMDM5MzA5Nn0.NZ-4BIGMwhbFp-KUrV6e7hReBGyyRaSVdH7o07yOpB8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 低饱和莫兰迪色系，单元按顺序循环取色（与 preview.html 一致）
const UNIT_PALETTE = ['#5e7280','#a87c57','#7d9069','#8d6f82','#a78f63','#9c7b6e','#6f8aa0','#8a7da0','#7a9c8a','#b09a6a'];

// ====== 状态 ======
let appData = { password: '1234', units: [] };
let pendingCoverImage = null;   // 单元编辑弹窗中待保存的封面图 URL
let coverUploadPromise = null;  // 封面上传进行中的 Promise，保存前需先等其完成
let currentUnitIndex = -1;
let currentSlideIndex = 0;
let currentImageIndex = 0; // 当前显示的多图索引
let lastCardRect = null;   // 进入演示时记录卡片位置，退出时做对称缩小动画
let presentationReturnScreen = 'dashboard-screen'; // 退出演示后返回的来源页（管理页预览则回管理页）
let isEditing = false;
let editingUnitId = null;
let editingSlideId = null;
let dataReady = false;

// 沉浸式大图查看器状态
let ivItems = [];
let ivIndex = 0;
let ivLoadSeq = 0;
let ivClickTimer = null;
let ivHideTimer = null;
let exploreActive = false;
let exploreCollapseTimer = null;
let exploreResizeHandler = null;
let exploreCurrentIdx = -1;
let exploreLayoutInfo = null;

// 临时存储编辑中的图片列表 [{url, isExisting}]
let editingImages = [];

// 临时存储编辑中的视频列表 [{url, isExisting, isTemp, file}]
let editingVideos = [];

// 画廊项队列（图片+视频统一管理）
let currentGalleryItems = [];

// ====== 工具 ======
function $(id) { return document.getElementById(id); }
function generateId() { return 's-' + Date.now() + '-' + Math.floor(Math.random() * 10000); }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
function escapeAttr(str) { return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
}

function showToast(msg, type) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500);
}

// ====== 多图解析 ======
// image_url 字段存多张图，用 \n 分隔
function parseImages(imageUrl) {
    if (!imageUrl) return [];
    return imageUrl.split('\n').map(s => s.trim()).filter(Boolean);
}

// ====== 多视频解析 ======
// video_url 字段存多个视频，用 \n 分隔
function parseVideos(videoUrl) {
    if (!videoUrl) return [];
    return videoUrl.split('\n').map(s => s.trim()).filter(Boolean);
}

// ====== 视频平台检测 ======
function detectVideoType(url) {
    if (!url) return null;

    // B站：bilibili.com
    const bvMatch = url.match(/bilibili\.com\/video\/(BV\w+)/i);
    if (bvMatch) {
        return { type: 'bilibili', embed: 'https://player.bilibili.com/player.html?bvid=' + bvMatch[1] + '&high_quality=1&autoplay=0&page=1' };
    }
    const avMatch = url.match(/bilibili\.com\/video\/(av\d+)/i);
    if (avMatch) {
        return { type: 'bilibili', embed: 'https://player.bilibili.com/player.html?aid=' + avMatch[1].replace(/av/i, '') + '&high_quality=1&autoplay=0&page=1' };
    }
    // B站短链 b23.tv
    if (url.match(/b23\.tv/i)) {
        return { type: 'bilibili', embed: url, raw: true };
    }

    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (ytMatch) {
        return { type: 'youtube', embed: 'https://www.youtube.com/embed/' + ytMatch[1] };
    }

    // 直接视频文件
    if (url.match(/\.(mp4|webm|ogg|mov)(\?|$)/i)) {
        return { type: 'file', src: url };
    }

    // 其他 http 链接，尝试当视频文件
    if (url.startsWith('http')) {
        return { type: 'file', src: url };
    }

    return null;
}

function renderVideo(url) {
    const v = detectVideoType(url);
    if (!v) return '';

    if (v.type === 'bilibili') {
        if (v.raw) {
            // b23.tv 短链，用 iframe 加载后会自动跳转
            return '<div class="slide-video-embed"><iframe src="' + escapeHtml(url) + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe></div>';
        }
        return '<div class="slide-video-embed"><iframe src="' + escapeHtml(v.embed) + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe></div>';
    }
    if (v.type === 'youtube') {
        return '<div class="slide-video-embed"><iframe src="' + escapeHtml(v.embed) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
    }
    if (v.type === 'file') {
        return '<video src="' + escapeHtml(v.src) + '" controls></video>';
    }
    return '';
}

// ====== 视频封面获取 ======

// YouTube 封面图
function getYouTubeCover(url) {
    var ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (ytMatch) return 'https://img.youtube.com/vi/' + ytMatch[1] + '/hqdefault.jpg';
    return null;
}

// B站封面异步获取（可能被 CORS 拦截，失败则保留占位）
function tryFetchBilibiliCover(url, elementId) {
    var bvMatch = url.match(/bilibili\.com\/video\/(BV\w+)/i);
    if (!bvMatch) return;

    fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvMatch[1])
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            if (data.code === 0 && data.data && data.data.pic) {
                var el = document.getElementById(elementId);
                if (el) {
                    var coverUrl = data.data.pic.replace('http://', 'https://');
                    el.style.backgroundImage = 'url(' + coverUrl + ')';
                    el.classList.add('has-cover');
                }
            }
        })
        .catch(function() { /* CORS 拦截或网络错误，保留占位图 */ });
}

// 构建视频封面卡片（画廊主区域）
function buildVideoCoverCard(videoUrl, idx) {
    var v = detectVideoType(videoUrl);
    if (!v) return '';

    var dataAttr = ' data-video-url="' + escapeAttr(videoUrl) + '" data-idx="' + idx + '"';

    if (v.type === 'file') {
        return '<div class="video-cover-card"' + dataAttr + '>' +
            '<video src="' + escapeAttr(v.src) + '" preload="metadata" muted></video>' +
            '<div class="cover-play-btn">\u25B6</div>' +
            '</div>';
    }

    if (v.type === 'youtube') {
        var cover = getYouTubeCover(videoUrl);
        return '<div class="video-cover-card"' + dataAttr + '>' +
            '<img src="' + escapeAttr(cover) + '" alt="\u89C6\u9891\u5C01\u9762" />' +
            '<div class="cover-play-btn">\u25B6</div>' +
            '</div>';
    }

    // B站：先显示渐变占位，异步尝试获取封面
    var placeholderId = 'bili-cover-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    tryFetchBilibiliCover(videoUrl, placeholderId);

    return '<div class="video-cover-card bili-placeholder" id="' + placeholderId + '"' + dataAttr + '>' +
        '<div class="cover-placeholder-content">' +
        '<div class="cover-play-btn">\u25B6</div>' +
        '<div class="cover-label">B\u7AD9\u89C6\u9891</div>' +
        '</div>' +
        '</div>';
}

// 构建视频缩略图（画廊队列条）
function buildVideoThumb(videoUrl, idx, isActive) {
    var v = detectVideoType(videoUrl);
    if (!v) return '';

    var activeClass = isActive ? ' active' : '';
    var dataAttr = ' data-idx="' + idx + '" data-video-url="' + escapeAttr(videoUrl) + '"';

    if (v.type === 'file') {
        return '<div class="video-gallery-item' + activeClass + '"' + dataAttr + '>' +
            '<video src="' + escapeAttr(v.src) + '" preload="metadata" muted></video>' +
            '<div class="play-badge"><div class="play-badge-icon">\u25B6</div></div>' +
            '</div>';
    }

    if (v.type === 'youtube') {
        var cover = getYouTubeCover(videoUrl);
        return '<div class="video-gallery-item' + activeClass + '"' + dataAttr + '>' +
            '<img src="' + escapeAttr(cover) + '" alt="" />' +
            '<div class="play-badge"><div class="play-badge-icon">\u25B6</div></div>' +
            '</div>';
    }

    // B站缩略图
    return '<div class="video-gallery-item' + activeClass + '"' + dataAttr + '>' +
        '<div class="thumb-bili-bg"><span class="bili-icon">B</span></div>' +
        '<div class="play-badge"><div class="play-badge-icon">\u25B6</div></div>' +
        '</div>';
}

// ====== 画廊事件绑定 ======
function bindGalleryEvents(container) {
    // 图片点击 → 打开沉浸式大图查看器（仅包含图片，不含视频）
    container.querySelectorAll('img[data-full]').forEach(function(img) {
        img.addEventListener('click', function(e) {
            e.stopPropagation();
            var unit = appData.units[currentUnitIndex];
            var slide = (unit && unit.slides) ? unit.slides[currentSlideIndex] : null;
            var title = slide ? slide.title : '';
            var imageItems = currentGalleryItems
                .filter(function(item) { return item.type === 'image'; })
                .map(function(item) { return { url: item.url, title: title }; });
            if (!imageItems.length) {
                imageItems = [{ url: this.getAttribute('data-full'), title: title }];
            }
            var idx = parseInt(this.getAttribute('data-idx') || '0');
            openImmersiveViewer(imageItems, Math.min(idx, Math.max(0, imageItems.length - 1)));
        });
    });

    // 视频封面卡片点击（仅主区域）→ 弹窗播放
    container.querySelectorAll('.video-cover-card[data-video-url]').forEach(function(card) {
        card.addEventListener('click', function(e) {
            e.stopPropagation();
            openVideoModal(this.getAttribute('data-video-url'));
        });
    });

    // 缩略图点击事件已移至 bindThumbBarEvents（底部固定横条）
}

async function loadData() {
    const { data: units, error: uErr } = await sb.from('units').select('*').order('sort_order', { ascending: true });
    if (uErr) throw uErr;

    const { data: slides, error: sErr } = await sb.from('slides').select('*').order('sort_order', { ascending: true });
    if (sErr) throw sErr;

    const { data: pwdRow } = await sb.from('app_settings').select('*').eq('key', 'password').single();

    const unitsWithSlides = (units || []).map(u => ({
        id: u.id,
        name: u.name,
        icon: parseUnitIcon(u.description), // 章节图标复用在 description 列（仅短图标，长文本不作图标）
        slides: (slides || []).filter(s => s.unit_id === u.id).map(s => ({
            id: s.id,
            title: s.title,
            images: parseImages(s.image_url),
            videos: parseVideos(s.video_url),
            audio: s.audio_url,
            text: s.text_content
        }))
    }));

    return {
        password: pwdRow?.value || '1234',
        units: unitsWithSlides
    };
}

async function migrateDefaultData() {
    const D = DEFAULT_DATA;
    for (let i = 0; i < D.units.length; i++) {
        const unit = D.units[i];
        await sb.from('units').insert({
            id: unit.id,
            name: unit.name,
            description: unit.description || '',
            sort_order: i
        });
        const slides = unit.slides || [];
        for (let j = 0; j < slides.length; j++) {
            const s = slides[j];
            // 把 image 字段转成 image_url（兼容单图）
            const imageUrl = s.image || null;
            // 把 video/videos 字段转成 video_url
            const videoUrl = (s.videos && s.videos.length > 0) ? s.videos.join('\n') : (s.video || null);
            await sb.from('slides').insert({
                id: s.id,
                unit_id: unit.id,
                title: s.title || '',
                image_url: imageUrl,
                video_url: videoUrl,
                audio_url: s.audio || null,
                text_content: s.text || null,
                sort_order: j
            });
        }
    }
}

async function dbInsertUnit(name, icon) {
    const id = generateId();
    const sortOrder = appData.units.length;
    const { error } = await sb.from('units').insert({
        id: id,
        name: name,
        description: icon || '', // 章节图标
        sort_order: sortOrder
    });
    if (error) throw error;
    return { id: id, name: name, icon: icon || '', slides: [] };
}

async function dbUpdateUnit(unitId, name, icon) {
    const { error } = await sb.from('units').update({ name: name, description: icon || '' }).eq('id', unitId);
    if (error) throw error;
}

async function dbDeleteUnit(unitId) {
    await sb.from('slides').delete().eq('unit_id', unitId);
    const { error } = await sb.from('units').delete().eq('id', unitId);
    if (error) throw error;
}

async function dbSaveSlide(slide, unitId, isEdit, editId) {
    // 把 images 数组用 \n 拼接存入 image_url
    const imageUrl = (slide.images && slide.images.length > 0) ? slide.images.join('\n') : null;
    // 把 videos 数组用 \n 拼接存入 video_url
    const videoUrl = (slide.videos && slide.videos.length > 0) ? slide.videos.join('\n') : null;

    const dbSlide = {
        id: isEdit ? editId : generateId(),
        unit_id: unitId,
        title: slide.title,
        image_url: imageUrl,
        video_url: videoUrl,
        audio_url: slide.audio || null,
        text_content: slide.text || null
    };

    if (isEdit) {
        const { error } = await sb.from('slides').update(dbSlide).eq('id', editId);
        if (error) throw error;
        return {
            id: editId,
            title: slide.title,
            images: slide.images || [],
            videos: slide.videos || [],
            audio: slide.audio,
            text: slide.text
        };
    } else {
        const { data, error } = await sb.from('slides').insert(dbSlide).select().single();
        if (error) throw error;
        return {
            id: data.id,
            title: slide.title,
            images: slide.images || [],
            videos: slide.videos || [],
            audio: slide.audio,
            text: slide.text
        };
    }
}

async function dbDeleteSlide(slideId) {
    const { error } = await sb.from('slides').delete().eq('id', slideId);
    if (error) throw error;
}

async function dbUpdatePassword(pwd) {
    const { error } = await sb.from('app_settings').upsert({ key: 'password', value: pwd, updated_at: new Date().toISOString() });
    if (error) throw error;
}

async function uploadFile(file, folder, onProgress) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const fileName = folder + '/' + Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '.' + ext;

    const options = { cacheControl: '3600' };
    if (typeof onProgress === 'function') options.onUploadProgress = onProgress;
    const { error } = await sb.storage.from('media').upload(fileName, file, options);
    if (error) throw error;

    const { data } = sb.storage.from('media').getPublicUrl(fileName);
    return data.publicUrl;
}

// 进度条辅助：把百分比(0~100)写到进度条填充层
function updateProgress(bar, pct) {
    if (!bar) return;
    const fill = bar.querySelector('.upload-progress-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

// 单元封面图上传：选中文件即上传到 storage，URL 暂存到 pendingCoverImage
async function onUnitCoverImageChange(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    const preview = document.getElementById('unit-cover-preview');
    const bar = document.getElementById('unit-cover-progress');
    const saveBtn = document.querySelector('#modal-body .btn-primary');
    if (!file) return;
    if (preview) { preview.src = URL.createObjectURL(file); preview.style.display = 'block'; }
    if (bar) { bar.style.display = 'block'; updateProgress(bar, 0); }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '上传中…'; }
    // 记录进行中的上传，保存时需先 await，避免“还没传完就保存”导致没存上
    coverUploadPromise = (async () => {
        try {
            const url = await uploadFile(file, 'images', (ev) => {
                if (bar && ev.lengthComputable) updateProgress(bar, ev.loaded / ev.total * 100);
            });
            pendingCoverImage = url;
            if (preview) preview.src = url;
            if (bar) updateProgress(bar, 100);
            showToast('封面图已上传', 'success');
            return url;
        } catch (err) {
            showToast('上传失败：' + (err.message || '网络错误'), 'error');
            return null;
        } finally {
            if (bar) setTimeout(() => { bar.style.display = 'none'; }, 400);
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存'; }
            coverUploadPromise = null;
        }
    })();
}

function unitCoverImageField(existingUrl) {
    return `
        <div class="form-group">
            <label>封面图片（选填，优先于图标显示在首页卡片）</label>
            <input type="file" id="unit-cover-image" accept="image/*" onchange="onUnitCoverImageChange(event)" />
            <img id="unit-cover-preview" class="cover-preview" ${existingUrl ? `src="${escapeAttr(existingUrl)}"` : ''} style="display:${existingUrl ? 'block' : 'none'};" alt="封面预览" />
            <div class="upload-progress" id="unit-cover-progress" style="display:none"><div class="upload-progress-fill"></div></div>
        </div>`;
}

// 从首页卡片直接更换某单元封面：复用封面图上传逻辑，保存时只更新该单元封面页(第一页)的图片
function showCoverImageModal(unitIdx) {
    const unit = appData.units[unitIdx];
    if (!unit) return;
    const cover = (unit.slides && unit.slides[0]) || {};
    const coverImg = (cover.images && cover.images[0]) || '';
    pendingCoverImage = null;
    $('modal-title').textContent = '更换封面：' + unit.name;
    $('modal-body').innerHTML = `
        <p style="color:var(--text-secondary);font-size:0.92rem;margin:0 0 14px;">更换后主页卡片与演示封面页将同步更新。</p>
        ${unitCoverImageField(coverImg)}
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="saveUnitCoverImage(${unitIdx})">保存</button>
        </div>
    `;
    openModal();
}

async function saveUnitCoverImage(unitIdx) {
    const unit = appData.units[unitIdx];
    if (!unit) return;
    // 若封面上传仍在进行，先等其完成，确保 pendingCoverImage 已就绪
    if (coverUploadPromise) {
        try { await coverUploadPromise; } catch (e) {}
    }
    if (!unit.slides) unit.slides = [];
    const newCoverImg = pendingCoverImage;   // null = 保留原图
    const existing = (unit.slides[0] && unit.slides[0].images && unit.slides[0].images[0]) || '';
    if (!newCoverImg && !existing) {
        showToast('请先上传封面图片', 'error');
        return;
    }
    const btn = $('modal-body').querySelector('.btn-primary');
    if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }
    try {
        if (unit.slides.length === 0) {
            const coverSlide = { id: generateId(), title: unit.name, text: '', images: newCoverImg ? [newCoverImg] : [], videos: [], audio: null };
            const saved = await dbSaveSlide(coverSlide, unit.id, false, null);
            unit.slides.push(saved);
        } else {
            const cover = unit.slides[0];
            const updated = { ...cover, images: newCoverImg ? [newCoverImg] : (cover.images || []) };
            const saved = await dbSaveSlide(updated, unit.id, true, cover.id);
            unit.slides[0] = saved;
        }
        pendingCoverImage = null;
        closeModal();
        renderDashboard();
        showToast('封面已更新', 'success');
    } catch (e) {
        showToast('保存失败：' + (e.message || '网络错误'), 'error');
        if (btn) { btn.textContent = '保存'; btn.disabled = false; }
    }
}

// ====== Slide 类型辅助 ======
function getSlideVideos(slide) {
    if (slide.videos && slide.videos.length > 0) return slide.videos;
    if (slide.video) return [slide.video]; // 向后兼容
    return [];
}

function getSlideTypes(slide) {
    const types = [];
    if (slide.images && slide.images.length > 0) types.push('image');
    if (getSlideVideos(slide).length > 0) types.push('video');
    if (slide.audio) types.push('audio');
    if (slide.text) types.push('text');
    return types;
}

function getSlideTypeTags(slide) {
    const types = getSlideTypes(slide);
    const labels = { image: '图片', video: '视频', audio: '音频', text: '文字' };
    return types.map(t => labels[t]);
}

function getUnitCoverIcon(slides) {
    const allTypes = slides.flatMap(getSlideTypes);
    if (allTypes.includes('video')) return '\u{1F3AC}';
    if (allTypes.includes('audio')) return '\u{1F3B5}';
    if (allTypes.includes('image')) return '\u{1F3BC}';
    return '\u{1F4D6}';
}

// 章节图标复用在 units.description 列：短字符串（emoji）视为图标，长文本则不认作图标
function parseUnitIcon(desc) {
    const d = (desc || '').trim();
    return d.length <= 4 ? d : '';
}

// ====== 仪表盘 ======
function renderDashboard() {
    const grid = $('units-grid');
    const empty = $('dashboard-empty');

    // 每次重新渲染都从居中的卡片堆开始
    exploreActive = false;
    exploreCurrentIdx = -1;
    clearTimeout(exploreCollapseTimer);
    if (exploreResizeHandler) {
        window.removeEventListener('resize', exploreResizeHandler);
        exploreResizeHandler = null;
    }

    if (!appData.units || appData.units.length === 0) {
        grid.innerHTML = '';
        grid.className = 'units-grid';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    grid.className = 'units-grid stack-scene';

    // 正序渲染：第 1 个单元在最前（左下），依次向右上叠放
    grid.innerHTML = '<div class="stack">' + appData.units.map((unit, index) => {
        const icon = unit.icon || getUnitCoverIcon(unit.slides || []);
        const color = UNIT_PALETTE[index % UNIT_PALETTE.length];
        const coverImg = (unit.slides && unit.slides[0] && unit.slides[0].images && unit.slides[0].images[0]) || '';
        const thumbHtml = coverImg
            ? `<div class="thumb has-cover" style="background-image:url('${escapeAttr(coverImg)}')"></div>`
            : `<div class="thumb"><span>${icon}</span></div>`;
        return `<div class="stack-card" data-idx="${index}" style="--c:${color}" title="${escapeAttr(unit.name)}">${thumbHtml}</div>`;
    }).join('') + '</div>';
    grid.insertAdjacentHTML('beforeend',
        '<div class="stack-preview" id="stack-preview">' +
        '<div class="sp-card" id="sp-card"><span class="sp-icon" id="sp-icon"></span></div>' +
        '<div class="sp-name" id="sp-name"></div>' +
        '<div class="sp-sub" id="sp-sub"></div>' +
        '</div>');

    const cards = Array.prototype.slice.call(grid.querySelectorAll('.stack-card'));
    const stack = grid.querySelector('.stack');
    cards.forEach(c => {
        c.addEventListener('click', () => startPresentation(+c.dataset.idx, c));
        c.addEventListener('mouseenter', () => {
            const idx = parseInt(c.dataset.idx, 10);
            enterExplore(grid, stack, cards);
            setCurrentCard(cards, idx);
        });
    });

    // 中间展示台：点击直接打开当前单元
    const preview = $('sp-card');
    if (preview) {
        preview.addEventListener('click', () => {
            if (exploreCurrentIdx >= 0) startPresentation(exploreCurrentIdx, null);
        });
    }

    // 鼠标进入/离开卡片区域：进入时展开，离开后延迟收起
    grid.addEventListener('mouseenter', () => clearTimeout(exploreCollapseTimer));
    grid.addEventListener('mouseleave', () => {
        clearTimeout(exploreCollapseTimer);
        exploreCollapseTimer = setTimeout(exitExplore, 300);
    });

    updateStackPositions(grid);
    updateStackCaption(0);
    updatePreview(0);
}

// 是否支持展开交互（桌面 + 有鼠标悬停）
function canExplore() {
    return !!(window.matchMedia && window.matchMedia('(hover: hover)').matches) && window.innerWidth >= 900;
}

// 进入 explore：整组卡片让到左侧竖向排列，中间展示当前卡片
function enterExplore(grid, stack, cards) {
    if (exploreActive) return;
    if (!canExplore()) return;
    exploreActive = true;
    grid.classList.add('explore');
    if (stack) stack.classList.add('explore');
    exploreLayoutInfo = layoutExplore(grid, stack, cards);

    // 卡片多到放不下时，跟随鼠标上下滚动
    grid.addEventListener('mousemove', function(e) {
        if (!exploreActive || !exploreLayoutInfo || exploreLayoutInfo.scrollRange <= 0) return;
        const st = this.querySelector('.stack');
        if (!st) return;
        const frac = (e.clientY - exploreLayoutInfo.railTop) / exploreLayoutInfo.areaH;
        const t = Math.max(0, Math.min(1, frac));
        st.style.setProperty('--rail-scroll', (t * exploreLayoutInfo.scrollRange).toFixed(1));
    });

    if (exploreResizeHandler) window.removeEventListener('resize', exploreResizeHandler);
    exploreResizeHandler = function() {
        if (!canExplore()) { exitExplore(); return; }
        if (exploreActive) exploreLayoutInfo = layoutExplore(grid, stack, cards);
    };
    window.addEventListener('resize', exploreResizeHandler);
}

// 退出 explore：卡片回到居中叠放，下方提示条保留当前卡片
function exitExplore() {
    if (!exploreActive) return;
    exploreActive = false;
    clearTimeout(exploreCollapseTimer);
    const grid = $('units-grid');
    if (!grid) return;
    grid.classList.remove('explore');
    const stack = grid.querySelector('.stack');
    if (stack) {
        stack.classList.remove('explore');
        stack.style.setProperty('--rail-scroll', 0);
    }
    exploreLayoutInfo = null;
}

// 计算左侧竖排位置：写入 --ex-dx / --ex-dy / --ex-s
function layoutExplore(grid, stack, cards) {
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const vh = window.innerHeight;
    const N = cards.length;
    const scale = 0.34;
    const cardH = 269 * scale;

    // 竖向排列的高度不超过中间展示卡片的高度
    const spCard = $('sp-card');
    let areaH = spCard ? spCard.getBoundingClientRect().height : 380;
    areaH = Math.max(180, Math.min(areaH, vh - 180));

    // 叠放：后一张只露出上方一小部分；能放下就保持 34px 露边，放不下则压缩
    const MIN_STRIP = 18;
    let spacing = N > 1 ? Math.min(34, (areaH - cardH) / (N - 1)) : 0;
    if (spacing < MIN_STRIP) spacing = MIN_STRIP;
    const railH = (N - 1) * spacing + cardH;

    // 与中间展示卡片垂直居中对齐
    const startY = gridRect.top + Math.max(0, (gridRect.height - railH) / 2);
    const railLeft = gridRect.left + 24;

    if (stack) stack.style.setProperty('--rail-scroll', 0);
    cards.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        const dx = railLeft - r.left;
        // 顺序与斜向一致：第一张在最下方，后面的依次往上叠
        const dy = (startY + (N - 1 - i) * spacing) - r.top;
        c.style.setProperty('--ex-dx', dx.toFixed(1));
        c.style.setProperty('--ex-dy', dy.toFixed(1));
        c.style.setProperty('--ex-s', scale);
    });

    return {
        railTop: startY,
        areaH: areaH,
        scrollRange: Math.max(0, railH - areaH)
    };
}

// 设置当前展示的卡片：竖排高亮 + 中间展示台 + 下方提示条
function setCurrentCard(cards, idx) {
    exploreCurrentIdx = idx;
    cards.forEach(o => o.classList.remove('current'));
    const c = cards[idx];
    if (c) c.classList.add('current');
    updatePreview(idx);
    updateStackCaption(idx);
}

// 中间展示台内容
function updatePreview(idx) {
    const card = $('sp-card');
    if (!card) return;
    const iconEl = $('sp-icon');
    const nameEl = $('sp-name');
    const subEl = $('sp-sub');
    const unit = appData.units[idx];
    if (!unit) {
        card.className = 'sp-card';
        card.style.backgroundImage = '';
        if (iconEl) iconEl.textContent = '';
        if (nameEl) nameEl.textContent = '';
        if (subEl) subEl.textContent = '';
        return;
    }
    const slides = unit.slides || [];
    const icon = unit.icon || getUnitCoverIcon(slides);
    const coverImg = (slides[0] && slides[0].images && slides[0].images[0]) || '';
    card.style.setProperty('--unit-color', UNIT_PALETTE[idx % UNIT_PALETTE.length]);
    card.className = 'sp-card' + (coverImg ? ' has-cover' : '');
    card.style.backgroundImage = coverImg ? "url('" + escapeAttr(coverImg) + "')" : '';
    if (iconEl) iconEl.textContent = icon;
    if (nameEl) nameEl.textContent = unit.name;
    if (subEl) subEl.textContent = (icon ? icon + ' · ' : '') + slides.length + ' 页';
}

// 首页卡片堆下方的单元预览条：缩略图 + 名称 + 页数（悬停时切换）
function updateStackCaption(idx) {
    const cap = $('stack-caption');
    if (!cap) return;
    const unit = appData.units[idx];
    if (!unit) { cap.innerHTML = ''; return; }
    const slides = unit.slides || [];
    const icon = unit.icon || getUnitCoverIcon(slides);
    const coverImg = (unit.slides && unit.slides[0] && unit.slides[0].images && unit.slides[0].images[0]) || '';
    const thumbHtml = coverImg
        ? '<span class="sc-thumb" style="background-image:url(\'' + escapeAttr(coverImg) + '\');background-size:cover;background-position:center;"></span>'
        : '<span class="sc-thumb">' + icon + '</span>';
    cap.style.setProperty('--unit-color', UNIT_PALETTE[idx % UNIT_PALETTE.length]);
    cap.innerHTML = thumbHtml +
        '<div class="sc-info"><div class="sc-name">' + escapeHtml(unit.name) + '</div>' +
        '<div class="sc-sub">' + escapeHtml(icon ? icon + ' · ' : '') + slides.length + ' 页</div></div>';
}

// 卡片按数组顺序叠成一摞：最前一张在左下，越往后越向右上错开，
// 后排卡片露出左下边缘，悬停/点击均不会被前面的卡片挡住。
function updateStackPositions(root) {
    const SOLID = 10;   // 最多 10 张实心，超出部分逐渐淡化消失
    (root || document).querySelectorAll('.stack-card').forEach((c, i) => {
        const s = i;    // 按 DOM 顺序（倒序后：最前 = 0）
        c.style.setProperty('--x', 23 + s * 34);
        c.style.setProperty('--y', 131 - s * 10);
        c.style.zIndex = 100 - s * 2;
        c.style.setProperty('--op', s < SOLID
            ? '1'
            : String(Math.max(0, 0.55 - (s - SOLID + 1) * 0.22)));
        c.style.pointerEvents = 'auto';
    });
}

// ====== 单元内幻灯片上下移动排序（兼容触屏） ======
function moveSlide(unitId, slideId, dir) {
    const unit = appData.units.find(u => u.id === unitId);
    if (!unit || !unit.slides) return;
    const arr = unit.slides;
    const idx = arr.findIndex(s => s.id === slideId);
    if (idx < 0 || idx === 0) return; // 封面页锁定，不可移动
    const target = idx + dir;
    if (target === 0 || target >= arr.length) return; // 不能移到封面之上 / 越界
    const tmp = arr[idx]; arr[idx] = arr[target]; arr[target] = tmp;
    renderAdminUnits();
    saveSlidesOrder(unit);
}

async function saveSlidesOrder(unit) {
    try {
        for (let i = 0; i < unit.slides.length; i++) {
            const s = unit.slides[i];
            await sb.from('slides').update({ sort_order: i }).eq('id', s.id);
        }
    } catch (e) {
        showToast('页面顺序保存失败：' + (e.message || '网络错误'), 'error');
    }
}

// ====== 单元整体排序（上下移动） ======
function moveUnit(unitId, dir) {
    const idx = appData.units.findIndex(u => u.id === unitId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= appData.units.length) return;
    const tmp = appData.units[idx];
    appData.units[idx] = appData.units[target];
    appData.units[target] = tmp;
    renderAdminUnits();
    renderDashboard();
    saveUnitsOrder();
}

async function saveUnitsOrder() {
    try {
        for (let i = 0; i < appData.units.length; i++) {
            const u = appData.units[i];
            await sb.from('units').update({ sort_order: i }).eq('id', u.id);
        }
    } catch (e) {
        showToast('单元顺序保存失败：' + (e.message || '网络错误'), 'error');
    }
}

// ====== 演示模式 ======
function startPresentation(unitIndex, cardEl) {
    currentUnitIndex = unitIndex;
    currentSlideIndex = 0;
    currentImageIndex = 0;
    const unit = appData.units[unitIndex];
    $('presentation-screen').style.setProperty('--unit-color', UNIT_PALETTE[unitIndex % UNIT_PALETTE.length]);
    $('presentation-title').textContent = unit.name;

    const screen = $('presentation-screen');
    // 先在被点卡片仍可见时记录其位置/尺寸——切屏后仪表盘 display:none，取不到正确矩形
    let first = null;
    if (cardEl) first = cardEl.getBoundingClientRect();
    lastCardRect = first;   // 供退出时做对称缩小
    presentationReturnScreen = cardEl ? 'dashboard-screen' : 'admin-screen';

    switchScreen('presentation-screen');

    // 卡片“抽出并放大”成全屏（FLIP）：以卡片中心为锚点直接放大到全屏，
    // 只动 transform，避免与 .screen 的 opacity 过渡冲突而卡顿。
    // 缩放期间把屏幕底色设为透明、并立即渲染可见的幻灯片内容，
    // 这样放大的是“卡片图片本身”，而不是一个先白屏再淡入的空屏。
    if (first && first.width) {
        const vw = window.innerWidth, vh = window.innerHeight;
        const sx = first.width / vw, sy = first.height / vh;
        const cx = first.left + first.width / 2;
        const cy = first.top + first.height / 2;
        screen.style.transition = 'none';
        screen.style.transformOrigin = 'center center';
        screen.style.background = 'transparent';
        screen.style.transform = `translate(${cx - vw / 2}px, ${cy - vh / 2}px) scale(${sx}, ${sy})`;
        void screen.offsetWidth;   // 提交起始帧
        requestAnimationFrame(() => requestAnimationFrame(() => {
            // 更柔顺的缓出曲线 + 略长时长，减少“生硬感”
            screen.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)';
            screen.style.transform = 'translate(0,0) scale(1)';
        }));
        setTimeout(() => {
            screen.style.transition = '';
            screen.style.transform = '';
            screen.style.transformOrigin = '';
            screen.style.background = '';
        }, 720);
    }

    renderSlide(true);
    setupPresentationControls();
}

function renderSlide(immediate) {
    const unit = appData.units[currentUnitIndex];
    const slides = unit.slides || [];
    if (currentSlideIndex < 0 || currentSlideIndex >= slides.length) return;

    const slide = slides[currentSlideIndex];
    const container = $('presentation-content');
    currentImageIndex = 0;

    const build = () => {
        container.innerHTML = renderSlideContent(slide);

        // 渲染底部缩略图横条
        var thumbBar = $('presentation-thumb-bar');
        thumbBar.innerHTML = renderSlideThumbs();
        if (currentGalleryItems.length > 1) {
            thumbBar.classList.add('show');
        } else {
            thumbBar.classList.remove('show');
        }

        // 绑定画廊事件（图片放大、视频播放）
        bindGalleryEvents(container);
        // 绑定底部缩略图横条事件
        bindThumbBarEvents(thumbBar);

        const media = container.querySelector('video');
        if (media) media.play().catch(() => {});

        $('presentation-progress').textContent = (currentSlideIndex + 1) + ' / ' + slides.length;
        renderNavDots(slides.length);
    };

    if (immediate) {
        // 进入演示时立即渲染并取消淡入，让封面图随卡片一起放大，连贯到播放界面
        build();
        container.style.opacity = '1';
        container.style.transform = 'none';
        container.classList.add('visible');
    } else {
        container.style.opacity = '';
        container.style.transform = '';
        container.classList.remove('visible');
        setTimeout(() => {
            build();
            requestAnimationFrame(() => container.classList.add('visible'));
        }, 400);
    }
}

function switchImage(idx) {
    if (idx < 0 || idx >= currentGalleryItems.length) return;

    var container = $('presentation-content');
    var galleryMain = container.querySelector('.gallery-main');
    if (!galleryMain) return;

    currentImageIndex = idx;
    var item = currentGalleryItems[idx];

    // 淡出
    galleryMain.style.opacity = '0';
    galleryMain.style.transform = 'scale(0.96)';

    setTimeout(function() {
        // 重建主区域内容
        var newHtml = '';
        if (item.type === 'image') {
            newHtml = '<img src="' + escapeHtml(item.url) + '" data-full="' + escapeAttr(item.url) + '" data-idx="' + idx + '" alt="" />';
        } else if (item.type === 'video') {
            newHtml = buildVideoCoverCard(item.url, idx);
        }

        galleryMain.innerHTML = newHtml;

        // 重新绑定事件
        bindGalleryEvents(container);

        // 淡入
        galleryMain.style.opacity = '1';
        galleryMain.style.transform = 'scale(1)';

        // 更新底部缩略图横条高亮
        var thumbBar = $('presentation-thumb-bar');
        thumbBar.querySelectorAll('.image-thumb, .video-gallery-item').forEach(function(t) {
            t.classList.remove('active');
        });
        var thumb = thumbBar.querySelector('[data-idx="' + idx + '"]');
        if (thumb) thumb.classList.add('active');
    }, 250);
}

function renderSlideContent(slide) {
    var types = getSlideTypes(slide);
    var hasImage = types.includes('image');
    var hasVideo = types.includes('video');
    var hasAudio = types.includes('audio');
    var hasText = types.includes('text');
    var images = slide.images || [];
    var videos = getSlideVideos(slide);

    // 构建统一画廊队列（图片 + 视频）
    var galleryItems = [];
    images.forEach(function(url) { galleryItems.push({ type: 'image', url: url }); });
    videos.forEach(function(url) { galleryItems.push({ type: 'video', url: url }); });
    currentGalleryItems = galleryItems;

    // 构建画廊主区域 HTML（缩略图已移至底部固定横条）
    function buildGalleryMain() {
        if (galleryItems.length === 0) return '';
        var firstItem = galleryItems[0];
        var mainHtml;
        if (firstItem.type === 'image') {
            mainHtml = '<img src="' + escapeHtml(firstItem.url) + '" data-full="' + escapeAttr(firstItem.url) + '" data-idx="0" alt="' + escapeHtml(slide.title) + '" />';
        } else {
            mainHtml = buildVideoCoverCard(firstItem.url, 0);
        }
        return '<div class="gallery-main">' + mainHtml + '</div>';
    }

    // 构建侧栏内容（音频 + 文字）
    var audioHtml = hasAudio ?
        '<div class="side-audio-block"><span class="audio-icon">\u{1F3B5}</span><audio src="' + escapeHtml(slide.audio) + '" controls></audio></div>' : '';

    var textHtml = hasText ?
        '<div class="side-text-block"><h3>' + escapeHtml(slide.title) + '</h3><div class="text-body">' + escapeHtml(slide.text) + '</div></div>' : '';

    // --- 布局判断 ---

    // 纯文字
    if (types.length === 1 && hasText) {
        return '<div class="slide-text-only"><h3>' + escapeHtml(slide.title) + '</h3><div class="text-body">' + escapeHtml(slide.text) + '</div></div>';
    }

    // 纯音频
    if (types.length === 1 && hasAudio) {
        return '<div class="slide-audio-block"><span class="audio-icon">\u{1F3B5}</span><h3>' + escapeHtml(slide.title) + '</h3><audio src="' + escapeHtml(slide.audio) + '" controls></audio></div>';
    }

    // 有图片或视频 + 有音频或文字 → 50/50 分栏
    if ((hasImage || hasVideo) && (hasAudio || hasText)) {
        var sidePanel = audioHtml + textHtml;
        return '<div class="slide-split-layout"><div class="slide-main-area">' + buildGalleryMain() + '</div><div class="slide-side-panel">' + sidePanel + '</div></div>';
    }

    // 有图片或视频，无音频/文字 → 全宽画廊
    if (hasImage || hasVideo) {
        return '<div class="slide-layout"><div class="slide-media">' + buildGalleryMain() + '</div></div>';
    }

    // 音频 + 文字
    if (hasAudio && hasText) {
        return '<div class="slide-layout"><div class="slide-text"><h3>' + escapeHtml(slide.title) + '</h3><div class="text-body">' + escapeHtml(slide.text) + '</div></div><div class="slide-audio-block"><audio src="' + escapeHtml(slide.audio) + '" controls></audio></div></div>';
    }

    // 兜底
    return '<div class="slide-text-only"><h3>' + escapeHtml(slide.title) + '</h3></div>';
}

// 渲染底部缩略图横条
function renderSlideThumbs() {
    if (currentGalleryItems.length <= 1) return '';

    var html = '';
    currentGalleryItems.forEach(function(item, i) {
        if (item.type === 'image') {
            html += '<img class="image-thumb' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" src="' + escapeHtml(item.url) + '" alt="" />';
        } else {
            html += buildVideoThumb(item.url, i, i === 0);
        }
    });
    return html;
}

// 绑定底部缩略图横条事件
function bindThumbBarEvents(thumbBar) {
    thumbBar.querySelectorAll('[data-idx]').forEach(function(thumb) {
        thumb.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            switchImage(idx);
        });
    });
}

function renderNavDots(count) {
    $('nav-dots').innerHTML = Array(count).fill(0).map((_, i) =>
        '<span class="nav-dot ' + (i === currentSlideIndex ? 'active' : '') + '" onclick="goToSlide(' + i + ')"></span>'
    ).join('');
}

function goToSlide(index) {
    const unit = appData.units[currentUnitIndex];
    const slides = unit.slides || [];
    if (index < 0 || index >= slides.length) return;
    currentSlideIndex = index;
    renderSlide();
}

// 跨单元跳转：从目录的一级(单元)+二级(幻灯片)定位到任意页
function goToUnitSlide(unitIdx, slideIdx) {
    if (unitIdx < 0 || unitIdx >= appData.units.length) return;
    const unit = appData.units[unitIdx];
    const slides = unit.slides || [];
    if (slideIdx < 0 || slideIdx >= slides.length) return;
    currentUnitIndex = unitIdx;
    currentSlideIndex = slideIdx;
    currentImageIndex = 0;
    $('presentation-title').textContent = unit.name;
    renderSlide();
}

function nextSlide() {
    const unit = appData.units[currentUnitIndex];
    const slides = unit.slides || [];
    if (currentSlideIndex < slides.length - 1) { currentSlideIndex++; renderSlide(); }
}

function prevSlide() {
    if (currentSlideIndex > 0) { currentSlideIndex--; renderSlide(); }
}

function setupPresentationControls() {
    $('btn-exit-presentation').onclick = exitPresentationOrFullscreen;
    $('btn-toc').onclick = openToc;
    $('btn-fullscreen').onclick = toggleFullscreen;
    $('btn-admin-pres').onclick = showAdminPasswordModal;
    $('toc-close').onclick = closeToc;
    $('toc-overlay').onclick = function(e) {
        if (e.target === this) closeToc();
    };
    document.onkeydown = handlePresKeys;

    // 点击空白区域翻页：左半部分上一页，右半部分下一页
    $('presentation-stage').onclick = function(e) {
        // 弹窗 / 大图查看器打开时不翻页
        if (ivIsOpen()) return;
        if ($('video-modal-overlay').classList.contains('show')) return;

        // 点击到真正可交互的元素时不翻页；文字/留白区域均翻页
        var interactive = e.target.closest('img, video, audio, button, a, .video-cover-card, .image-thumb, .video-gallery-item, .slide-audio-block, textarea, input, .nav-dot, .presentation-bottombar, .presentation-thumb-bar, .presentation-topbar, .toc-overlay, .toc-panel');
        if (interactive) return;

        var rect = this.getBoundingClientRect();
        var x = e.clientX - rect.left;
        if (x < rect.width / 2) {
            prevSlide();
        } else {
            nextSlide();
        }
    };
}

// 退出按钮：全屏时先只退全屏，再点一次才退出演示（与 Esc 行为一致）
function exitPresentationOrFullscreen() {
    if (getFullscreenElement()) {
        exitFullscreen();
        showToast('已退出全屏，再点一次退出演示', 'info');
    } else {
        exitPresentation();
    }
}

function handlePresKeys(e) {
    if (!$('presentation-screen').classList.contains('active')) return;

    // 焦点在输入框时不触发快捷键
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

    // 目录浮层打开时
    if ($('toc-overlay').classList.contains('show')) {
        if (e.key === 'Escape') closeToc();
        return;
    }

    // 视频弹窗打开时
    if ($('video-modal-overlay').classList.contains('show')) {
        if (e.key === 'Escape') closeVideoModal();
        return;
    }

    // 沉浸式大图查看器打开时
    if (ivIsOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); closeImmersiveViewer(); }
        else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); ivNext(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); ivPrev(); }
        else if (e.key === 'f' || e.key === 'F') { ivToggleFullscreen(); }
        return;
    }

    switch(e.key) {
        case 'ArrowRight': case ' ': e.preventDefault(); nextSlide(); break;
        case 'ArrowLeft': e.preventDefault(); prevSlide(); break;
        case 'Escape':
            // 全屏状态下，Esc 先退出全屏，再按一次才退出演示
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                exitFullscreen();
            } else {
                exitPresentation();
            }
            break;
        case 'f': case 'F': toggleFullscreen(); break;
    }
}

function exitPresentation() {
    if (getFullscreenElement()) exitFullscreen();
    closeVideoModal();
    closeImmersiveViewer();
    closeToc();
    document.onkeydown = null;

    const screen = $('presentation-screen');
    const finish = () => {
        const container = $('presentation-content');
        container.querySelectorAll('video, audio').forEach(m => { m.pause(); m.src = ''; });
        container.innerHTML = '';
        const thumbBar = $('presentation-thumb-bar');
        thumbBar.innerHTML = '';
        thumbBar.classList.remove('show');
        screen.style.transition = '';
        screen.style.transform = '';
        screen.style.transformOrigin = '';
        switchScreen(presentationReturnScreen);
        if (presentationReturnScreen === 'dashboard-screen') renderDashboard();
        else renderAdminUnits();   // 从管理页预览进入，退出后回到管理页
    };

    // 对称缩小：从全屏缩回原卡片位置（若由管理页预览进入则无卡片，直接切回）
    if (lastCardRect && lastCardRect.width) {
        const vw = window.innerWidth, vh = window.innerHeight;
        const sx = lastCardRect.width / vw, sy = lastCardRect.height / vh;
        const cx = lastCardRect.left + lastCardRect.width / 2;
        const cy = lastCardRect.top + lastCardRect.height / 2;
        screen.style.transition = 'transform .5s cubic-bezier(.4,0,.2,1)';
        screen.style.transformOrigin = 'center center';
        screen.style.transform = `translate(${cx - vw / 2}px, ${cy - vh / 2}px) scale(${sx}, ${sy})`;
        setTimeout(finish, 520);
    } else {
        finish();
    }
}

// ====== 目录浮层 ======
// 两级目录：一级 = 单元，二级 = 单元内的幻灯片
function openToc() {
    const list = $('toc-list');
    let html = '';
    appData.units.forEach((unit, uIdx) => {
        const slides = unit.slides || [];
        const isCurrent = uIdx === currentUnitIndex;
        const slidesHtml = slides.map((slide, i) => {
            const label = (slide.title && slide.title.trim()) ? slide.title : ('第 ' + (i + 1) + ' 页');
            const thumb = (slide.images && slide.images[0])
                ? '<img class="toc-thumb" src="' + escapeHtml(slide.images[0]) + '" alt="" loading="lazy">'
                : '';
            const active = (isCurrent && i === currentSlideIndex) ? ' active' : '';
            return '<button class="toc-item' + active + '" data-unit-idx="' + uIdx + '" data-slide-idx="' + i + '">' +
                '<span class="toc-index">' + (i + 1) + '</span>' +
                thumb +
                '<span class="toc-label">' + escapeHtml(label) + '</span>' +
                '</button>';
        }).join('');
        html += `
            <div class="toc-unit${isCurrent ? ' active' : ''}">
                <button class="toc-unit-header" data-unit-idx="${uIdx}">
                    <span class="toc-unit-index">${uIdx + 1}</span>
                    <span class="toc-unit-name">${escapeHtml(unit.name)}</span>
                    <span class="toc-unit-count">${slides.length} 页</span>
                </button>
                <div class="toc-unit-slides">${slidesHtml}</div>
            </div>`;
    });
    list.innerHTML = html;

    // 一级（单元头）：跳到该单元第一页
    list.querySelectorAll('.toc-unit-header').forEach(function(h) {
        h.addEventListener('click', function() {
            const u = parseInt(this.getAttribute('data-unit-idx'));
            closeToc();
            goToUnitSlide(u, 0);
        });
    });
    // 二级（幻灯片）：跳到对应单元对应页
    list.querySelectorAll('.toc-item').forEach(function(item) {
        item.addEventListener('click', function() {
            const u = parseInt(this.getAttribute('data-unit-idx'));
            const s = parseInt(this.getAttribute('data-slide-idx'));
            closeToc();
            goToUnitSlide(u, s);
        });
    });
    $('toc-overlay').classList.add('show');
}

function closeToc() {
    const overlay = $('toc-overlay');
    if (overlay) overlay.classList.remove('show');
}

// ====== 全屏 ======
function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function toggleFullscreen() {
    if (!getFullscreenElement()) {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
        exitFullscreen();
    }
}

function exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}

function updateFullscreenButton() {
    const btn = $('btn-fullscreen');
    if (!btn) return;
    const fs = getFullscreenElement();
    const label = btn.querySelector('.fs-label');
    if (fs) {
        btn.classList.add('active');
        btn.querySelector('.fs-icon-enter').style.display = 'none';
        btn.querySelector('.fs-icon-exit').style.display = '';
        if (label) label.textContent = '退出全屏';
    } else {
        btn.classList.remove('active');
        btn.querySelector('.fs-icon-enter').style.display = '';
        btn.querySelector('.fs-icon-exit').style.display = 'none';
        if (label) label.textContent = '全屏';
    }
}

// ====== 沉浸式大图查看器（纯看图，无按钮） ======
function ivIsOpen() {
    const ov = $('immersive-viewer');
    return !!ov && ov.classList.contains('show');
}

function openImmersiveViewer(items, index) {
    ivItems = (items || []).filter(function(it) { return it && it.url; });
    if (ivItems.length === 0) return;
    ivIndex = Math.max(0, Math.min(index || 0, ivItems.length - 1));

    $('immersive-viewer').classList.add('show');
    ivRenderChrome();
    ivShowImage(ivItems[ivIndex].url);
    ivShowChrome();
}

// 底部圆点：显示当前是第几张，可点击跳转
function ivRenderChrome() {
    const dots = $('iv-dots');
    if (!dots) return;
    dots.innerHTML = ivItems.map(function(_, i) {
        return '<span class="iv-dot' + (i === ivIndex ? ' active' : '') + '" data-iv-dot="' + i + '"></span>';
    }).join('');
    dots.querySelectorAll('[data-iv-dot]').forEach(function(d) {
        d.addEventListener('click', function(e) {
            e.stopPropagation();
            ivGotoIndex(parseInt(this.getAttribute('data-iv-dot'), 10));
        });
    });
}

// 加载并淡入当前图片（带预加载与失败兜底）
function ivShowImage(url) {
    const img = $('iv-img');
    const loading = $('iv-loading');
    const error = $('iv-error');
    const seq = ++ivLoadSeq;

    loading.classList.add('show');
    error.classList.remove('show');
    img.classList.remove('iv-img-ready');
    img.classList.add('iv-img-leave');

    const pre = new Image();
    pre.onload = function() {
        if (seq !== ivLoadSeq) return;
        img.src = url;
        loading.classList.remove('show');
        requestAnimationFrame(function() {
            img.classList.remove('iv-img-leave');
            img.classList.add('iv-img-ready');
        });
    };
    pre.onerror = function() {
        if (seq !== ivLoadSeq) return;
        loading.classList.remove('show');
        error.classList.add('show');
        img.classList.remove('iv-img-leave');
    };
    pre.src = url;

    ivPreloadAdjacent();
}

// 预加载相邻图片，切换更快
function ivPreloadAdjacent() {
    if (ivItems.length < 2) return;
    [ivIndex - 1, ivIndex + 1].forEach(function(i) {
        if (i < 0 || i >= ivItems.length) return;
        const p = new Image();
        p.src = ivItems[i].url;
    });
}

function ivNext() {
    if (ivItems.length < 2) return;
    ivIndex = (ivIndex + 1) % ivItems.length;
    ivActivate();
}

function ivPrev() {
    if (ivItems.length < 2) return;
    ivIndex = (ivIndex - 1 + ivItems.length) % ivItems.length;
    ivActivate();
}

function ivGotoIndex(i) {
    if (i < 0 || i >= ivItems.length || i === ivIndex) return;
    ivIndex = i;
    ivActivate();
}

function ivActivate() {
    ivRenderChrome();
    ivShowImage(ivItems[ivIndex].url);
    ivShowChrome();
}

// 控制层 3 秒无操作自动隐藏
function ivShowChrome() {
    const chrome = $('iv-chrome');
    if (!chrome) return;
    chrome.classList.remove('hidden');
    clearTimeout(ivHideTimer);
    ivHideTimer = setTimeout(function() {
        chrome.classList.add('hidden');
    }, 3000);
}

// 键盘 F：静默切换浏览器全屏（无按钮）
function ivToggleFullscreen() {
    const fs = getFullscreenElement();
    if (fs && fs.id === 'immersive-viewer') { exitFullscreen(); return; }
    const el = $('immersive-viewer');
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}

function closeImmersiveViewer() {
    if (!ivIsOpen()) return;
    const ov = $('immersive-viewer');
    ov.classList.remove('show');
    clearTimeout(ivHideTimer);
    ivLoadSeq++;
    ivItems = [];

    const img = $('iv-img');
    img.classList.remove('iv-img-ready', 'iv-img-leave');
    img.src = '';
    $('iv-loading').classList.remove('show');
    $('iv-error').classList.remove('show');

    if (getFullscreenElement() && getFullscreenElement().id === 'immersive-viewer') {
        exitFullscreen();
    }
}

// 兼容旧入口
function openLightbox(images, index) {
    const unit = appData.units[currentUnitIndex];
    const slide = (unit && unit.slides) ? unit.slides[currentSlideIndex] : null;
    const title = slide ? slide.title : '';
    const items = (images || []).map(function(url) {
        return { url: url, title: title };
    });
    openImmersiveViewer(items, index);
}

function lightboxNext() { ivNext(); }
function lightboxPrev() { ivPrev(); }
function closeLightbox() { closeImmersiveViewer(); }

// ====== 视频弹窗播放器 ======
function openVideoModal(url) {
    const overlay = $('video-modal-overlay');
    const container = $('video-modal-content');
    container.innerHTML = renderVideoModalContent(url);
    overlay.classList.add('show');

    // 自动播放
    setTimeout(function() {
        const video = container.querySelector('video');
        if (video) video.play().catch(function() {});
    }, 300);
}

function closeVideoModal() {
    const overlay = $('video-modal-overlay');
    overlay.classList.remove('show');
    setTimeout(function() {
        $('video-modal-content').innerHTML = '';
    }, 300);
}

function renderVideoModalContent(url) {
    const v = detectVideoType(url);
    if (!v) return '';

    if (v.type === 'bilibili') {
        var src = v.raw ? url : (v.embed + '&autoplay=1');
        return '<iframe src="' + escapeAttr(src) + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" allow="autoplay"></iframe>';
    }
    if (v.type === 'youtube') {
        return '<iframe src="' + escapeAttr(v.embed) + '?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    }
    if (v.type === 'file') {
        return '<video src="' + escapeAttr(v.src) + '" controls autoplay></video>';
    }
    return '';
}

// ====== 管理密码门 ======
function showAdminPasswordModal() {
    $('modal-title').textContent = '管理验证';
    $('modal-body').innerHTML = `
        <div class="form-group">
            <label>请输入管理密码</label>
            <input type="password" id="admin-password-input" placeholder="输入密码" autocomplete="off" />
            <p class="login-hint" id="admin-password-hint"></p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="btn-verify-admin" onclick="verifyAdminPassword()">验证</button>
        </div>
    `;
    openModal();
    setTimeout(function() {
        var input = $('admin-password-input');
        if (input) {
            input.focus();
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') verifyAdminPassword();
            });
        }
    }, 200);
}

function verifyAdminPassword() {
    var input = $('admin-password-input');
    var hint = $('admin-password-hint');
    if (!input) return;

    if (input.value === appData.password) {
        closeModal();
        renderAdmin();
    } else {
        hint.textContent = '密码错误，请重试';
        input.classList.add('shake');
        setTimeout(function() { input.classList.remove('shake'); }, 400);
        input.value = '';
        input.focus();
    }
}

// ====== 管理面板 ======
function renderAdmin() {
    switchScreen('admin-screen');
    renderAdminUnits();
}

function renderAdminUnits() {
    const list = $('admin-units-list');

    if (appData.units.length === 0) {
        list.innerHTML = '<div class="admin-empty"><p>还没有任何单元，点击「新建单元」开始添加吧</p></div>';
        return;
    }

    list.innerHTML = appData.units.map((unit, unitIdx) => {
        const slides = unit.slides || [];
        const slidesHtml = slides.map((slide, sIdx) => {
            const isCover = sIdx === 0;
            const isFirstMovable = sIdx === 1; // 上移到封面之上不允许
            const isLast = sIdx === slides.length - 1;
            const types = getSlideTypes(slide);
            const icons = { image: '\u{1F5BC}', video: '\u{1F3AC}', audio: '\u{1F3B5}', text: '\u{1F4DD}' };
            const labels = { image: '图片', video: '视频', audio: '音频', text: '文字' };
            const typeIcons = types.map(t => icons[t]).join(' ');
            let typeLabels = types.map(t => labels[t]).join(' · ');
            const imgCount = slide.images ? slide.images.length : 0;
            const vidCount = getSlideVideos(slide).length;
            if (imgCount > 1 || vidCount > 1) {
                var parts = [];
                if (imgCount > 0) parts.push('图片 x' + imgCount);
                if (vidCount > 0) parts.push(vidCount > 1 ? '视频 x' + vidCount : '视频');
                if (slide.audio) parts.push('音频');
                if (slide.text) parts.push('文字');
                typeLabels = parts.join(' · ');
            }

            return `
                <div class="admin-item${isCover ? ' admin-item-cover' : ''}" data-unit-id="${unit.id}" data-slide-id="${slide.id}" data-index="${sIdx}">
                    <div class="admin-item-info">
                        <span class="item-type-icon">${typeIcons || '\u{1F4C4}'}</span>
                        <div>
                            <div class="item-title">${escapeHtml(slide.title || '未命名')}${isCover ? ' <span class="cover-badge">封面</span>' : ''}</div>
                            <div class="item-type-label">${typeLabels || '空'}</div>
                        </div>
                    </div>
                    <div class="admin-item-actions">
                        ${isCover ? '' : `<button class="order-btn" title="上移" ${isFirstMovable ? 'disabled' : ''} onclick="moveSlide('${unit.id}', '${slide.id}', -1)">↑</button><button class="order-btn" title="下移" ${isLast ? 'disabled' : ''} onclick="moveSlide('${unit.id}', '${slide.id}', 1)">↓</button>`}
                        <button class="btn-edit-item" onclick="editSlide('${unit.id}', '${slide.id}')">编辑</button>
                        <button class="btn-delete-item" onclick="deleteSlide('${unit.id}', '${slide.id}')">删除</button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="admin-unit" style="animation-delay: ${unitIdx * 0.08}s">
                <div class="admin-unit-header">
                    <h3>${escapeHtml(unit.name)}</h3>
                    <div class="admin-unit-actions">
                        <button class="order-btn" title="上移" ${unitIdx === 0 ? 'disabled' : ''} onclick="moveUnit('${unit.id}', -1)">↑</button>
                        <button class="order-btn" title="下移" ${unitIdx === appData.units.length - 1 ? 'disabled' : ''} onclick="moveUnit('${unit.id}', 1)">↓</button>
                        <button class="btn-add-item" onclick="addSlide('${unit.id}')">+ 添加页面</button>
                        <button class="btn-preview-unit" onclick="startPresentation(${unitIdx}, null)">预览</button>
                        <button class="btn-cover-unit" onclick="showCoverImageModal(${unitIdx})">换封面</button>
                        <button class="btn-edit-unit" onclick="editUnit('${unit.id}')">改名</button>
                        <button class="btn-delete-unit" onclick="deleteUnit('${unit.id}')">删除</button>
                    </div>
                </div>
                <div class="admin-items-list">
                    ${slidesHtml || '<p style="color:var(--text-dim);padding:12px 0;font-size:0.95rem;">还没有页面，点击「+ 添加页面」</p>'}
                </div>
            </div>
        `;
    }).join('');
}

// ====== 单元操作 ======
const UNIT_ICONS = ['🎵','🎶','🎼','🎹','🎻','🥁','🎷','🎺','🎸','🎤','📯','📖','📚','✏️','🎨','⭐'];

function selectUnitIconFromBtn(btn) {
    document.querySelectorAll('#unit-icon-picker .icon-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const input = $('unit-icon-input');
    if (input) input.value = btn.getAttribute('data-icon');
}

function unitIconPicker(current) {
    const cur = current || UNIT_ICONS[0];
    return `
        <div class="form-group">
            <label>章节图标</label>
            <div class="icon-picker" id="unit-icon-picker">
                ${UNIT_ICONS.map(ic => `<button type="button" class="icon-option${ic === cur ? ' selected' : ''}" data-icon="${ic}" onclick="selectUnitIconFromBtn(this)">${ic}</button>`).join('')}
            </div>
            <input type="hidden" id="unit-icon-input" value="${cur}" />
        </div>
    `;
}

function showAddUnitModal() {
    pendingCoverImage = null;
    $('modal-title').textContent = '新建单元';
    $('modal-body').innerHTML = `
        <div class="form-group">
            <label>单元名称（即封面标题）</label>
            <input type="text" id="unit-name-input" placeholder="例如：第四单元：流行音乐" />
        </div>
        ${unitIconPicker('🎵')}
        <div class="form-group">
            <label>封面文字（封面页正文）</label>
            <textarea id="unit-cover-input" rows="4" placeholder="选填，封面页展示的说明文字"></textarea>
        </div>
        ${unitCoverImageField('')}
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="saveUnit()">创建</button>
        </div>
    `;
    openModal();
    setTimeout(() => $('unit-name-input').focus(), 200);
}

async function saveUnit() {
    const name = $('unit-name-input').value.trim();
    if (!name) { $('unit-name-input').classList.add('shake'); return; }
    const coverText = ($('unit-cover-input') ? $('unit-cover-input').value : '').trim();
    const icon = ($('unit-icon-input') ? $('unit-icon-input').value : '🎵').trim();

    const btn = $('modal-body').querySelector('.btn-primary');
    if (btn) { btn.textContent = '创建中...'; btn.disabled = true; }

    try {
        const newUnit = await dbInsertUnit(name, icon);
        // 自动创建封面页（第一页）
        const coverSlide = { id: generateId(), title: name, text: coverText, images: pendingCoverImage ? [pendingCoverImage] : [], videos: [], audio: null };
        const savedCover = await dbSaveSlide(coverSlide, newUnit.id, false, null);
        newUnit.slides = [savedCover];
        appData.units.push(newUnit);
        pendingCoverImage = null;
        closeModal();
        renderAdminUnits();
        showToast('单元已创建', 'success');
    } catch (e) {
        showToast('创建失败：' + (e.message || '网络错误'), 'error');
        if (btn) { btn.textContent = '创建'; btn.disabled = false; }
    }
}

function editUnit(unitId) {
    const unit = appData.units.find(u => u.id === unitId);
    if (!unit) return;
    const cover = (unit.slides && unit.slides[0]) || {};
    const coverImg = (cover.images && cover.images[0]) || '';
    pendingCoverImage = null;
    $('modal-title').textContent = '修改单元';
    $('modal-body').innerHTML = `
        <div class="form-group">
            <label>单元名称（即封面标题）</label>
            <input type="text" id="unit-name-input" value="${escapeHtml(unit.name)}" />
        </div>
        ${unitIconPicker(unit.icon || '🎵')}
        <div class="form-group">
            <label>封面文字（封面页正文）</label>
            <textarea id="unit-cover-input" rows="4" placeholder="选填，封面页展示的说明文字">${escapeHtml(cover.text || '')}</textarea>
        </div>
        ${unitCoverImageField(coverImg)}
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="updateUnit('${unitId}')">保存</button>
        </div>
    `;
    openModal();
    setTimeout(() => $('unit-name-input').focus(), 200);
}

async function updateUnit(unitId) {
    const name = $('unit-name-input').value.trim();
    if (!name) return;
    const coverText = ($('unit-cover-input') ? $('unit-cover-input').value : '').trim();
    const icon = ($('unit-icon-input') ? $('unit-icon-input').value : '🎵').trim();

    const btn = $('modal-body').querySelector('.btn-primary');
    if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }

    try {
        await dbUpdateUnit(unitId, name, icon);
        const unit = appData.units.find(u => u.id === unitId);
        if (unit) {
            unit.name = name;
            unit.icon = icon;
            // 同步更新封面页（第一张 slide）的标题与正文，以及封面图
            if (!unit.slides) unit.slides = [];
            const newCoverImg = pendingCoverImage;
            if (unit.slides.length === 0) {
                const coverSlide = { id: generateId(), title: name, text: coverText, images: newCoverImg ? [newCoverImg] : [], videos: [], audio: null };
                const saved = await dbSaveSlide(coverSlide, unitId, false, null);
                unit.slides.push(saved);
            } else {
                const cover = unit.slides[0];
                const updated = { ...cover, title: name, text: coverText, images: newCoverImg ? [newCoverImg] : (cover.images || []) };
                const saved = await dbSaveSlide(updated, unitId, true, cover.id);
                unit.slides[0] = saved;
            }
        }
        pendingCoverImage = null;
        closeModal();
        renderAdminUnits();
        showToast('已保存', 'success');
    } catch (e) {
        showToast('保存失败：' + (e.message || '网络错误'), 'error');
        if (btn) { btn.textContent = '保存'; btn.disabled = false; }
    }
}

async function deleteUnit(unitId) {
    if (!confirm('确定删除这个单元及所有页面吗？')) return;
    try {
        await dbDeleteUnit(unitId);
        appData.units = appData.units.filter(u => u.id !== unitId);
        renderAdminUnits();
        showToast('单元已删除', 'success');
    } catch (e) {
        showToast('删除失败：' + (e.message || '网络错误'), 'error');
    }
}

// ====== 页面(Slide)操作 ======
function addSlide(unitId) {
    editingUnitId = unitId;
    editingSlideId = null;
    isEditing = false;
    $('modal-title').textContent = '添加页面';
    showSlideForm(null);
}

function editSlide(unitId, slideId) {
    editingUnitId = unitId;
    editingSlideId = slideId;
    isEditing = true;
    $('modal-title').textContent = '编辑页面';
    const unit = appData.units.find(u => u.id === unitId);
    const slides = unit ? (unit.slides || []) : [];
    const slide = slides.find(s => s.id === slideId);
    showSlideForm(slide);
}

function showSlideForm(existingSlide) {
    const s = existingSlide || {};
    const images = s.images || [];
    const videos = getSlideVideos(s);
    const hasImage = images.length > 0;
    const hasVideo = videos.length > 0;
    const hasAudio = !!s.audio;
    const hasText = !!s.text;

    // 初始化编辑图片列表
    editingImages = images.map(url => ({ url: url, isExisting: true }));
    // 初始化编辑视频列表
    editingVideos = videos.map(url => ({ url: url, isExisting: true }));

    $('modal-body').innerHTML = `
        <div class="form-group">
            <label>页面标题</label>
            <input type="text" id="slide-title" placeholder="给这个页面取个名字" value="${escapeHtml(s.title || '')}" />
        </div>

        <div class="element-section ${hasImage ? '' : 'collapsed'}" id="section-image">
            <div class="element-section-header">
                <label>\u{1F5BC} 图片（支持多张）</label>
                <div class="toggle-switch ${hasImage ? 'on' : ''}" onclick="toggleSection('section-image')"></div>
            </div>
            <div class="element-body">
                <input type="file" id="slide-image-file" accept="image/*" multiple />
                <p style="font-size:0.85rem;color:var(--text-muted);margin-top:8px;">可选择多张图片，按住 Ctrl/Cmd 多选</p>
                <div class="form-group" style="margin-top:10px;">
                    <input type="text" id="slide-image-url" placeholder="或输入图片网址（一张一行）" />
                </div>
                <div class="image-preview-list" id="image-preview-list"></div>
            </div>
        </div>

        <div class="element-section ${hasVideo ? '' : 'collapsed'}" id="section-video">
            <div class="element-section-header">
                <label>\u{1F3AC} 视频（支持多个）</label>
                <div class="toggle-switch ${hasVideo ? 'on' : ''}" onclick="toggleSection('section-video')"></div>
            </div>
            <div class="element-body">
                <input type="file" id="slide-video-file" accept="video/*" multiple />
                <p style="font-size:0.85rem;color:var(--text-muted);margin-top:8px;">可选择多个视频文件，或粘贴B站/YouTube链接</p>
                <div class="form-group" style="margin-top:10px;">
                    <input type="text" id="slide-video-url" placeholder="或输入视频网址（多个换行分隔）" />
                </div>
                <div class="video-preview-list" id="video-preview-list"></div>
            </div>
        </div>

        <div class="element-section ${hasAudio ? '' : 'collapsed'}" id="section-audio">
            <div class="element-section-header">
                <label>\u{1F3B5} 音频</label>
                <div class="toggle-switch ${hasAudio ? 'on' : ''}" onclick="toggleSection('section-audio')"></div>
            </div>
            <div class="element-body">
                <input type="file" id="slide-audio-file" accept="audio/*" />
                <div class="form-group" style="margin-top:10px;">
                    <input type="text" id="slide-audio-url" placeholder="或输入音频网址" value="${s.audio && s.audio.startsWith('http') ? escapeHtml(s.audio) : ''}" />
                </div>
                ${hasAudio && s.audio && !s.audio.startsWith('http') ? '<p style="font-size:0.85rem;color:var(--text-dim);margin-top:4px;">已有音频，不上传新文件则保留原音频</p>' : ''}
            </div>
        </div>

        <div class="element-section ${hasText ? '' : 'collapsed'}" id="section-text">
            <div class="element-section-header">
                <label>\u{1F4DD} 文字</label>
                <div class="toggle-switch ${hasText ? 'on' : ''}" onclick="toggleSection('section-text')"></div>
            </div>
            <div class="element-body">
                <textarea id="slide-text" placeholder="输入要展示的文字内容..." rows="6">${escapeHtml(s.text || '')}</textarea>
            </div>
        </div>

        <div class="upload-progress" id="slide-upload-progress" style="display:none; margin:0 0 14px;"><div class="upload-progress-fill"></div></div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" id="btn-save-slide" onclick="saveSlide()">${isEditing ? '保存' : '添加'}</button>
        </div>
    `;
    openModal();

    // 渲染已有图片预览
    renderImagePreviews();
    // 渲染已有视频预览
    renderVideoPreviews();

    // 监听文件选择
    $('slide-image-file').addEventListener('change', handleImageFileSelect);
    $('slide-video-file').addEventListener('change', handleVideoFileSelect);
}

function renderImagePreviews() {
    const container = $('image-preview-list');
    if (!container) return;
    container.innerHTML = editingImages.map((item, idx) => `
        <div class="image-preview-item">
            <img src="${escapeHtml(item.url)}" alt="" />
            <button class="image-preview-remove" onclick="removeImage(${idx})">\u00D7</button>
        </div>
    `).join('');
}

function removeImage(idx) {
    editingImages.splice(idx, 1);
    renderImagePreviews();
}

function handleImageFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(ev) {
            editingImages.push({ url: ev.target.result, isTemp: true, file: file });
            renderImagePreviews();
        };
        reader.readAsDataURL(file);
    });
    // 清空 input 以便再次选择
    e.target.value = '';
}

// ====== 视频预览 ======
function renderVideoPreviews() {
    const container = $('video-preview-list');
    if (!container) return;
    container.innerHTML = editingVideos.map(function(item, idx) {
        var v = detectVideoType(item.url);
        var typeName = '视频';
        var thumbHtml = '';
        if (v) {
            if (v.type === 'bilibili') typeName = 'B站视频';
            else if (v.type === 'youtube') {
                typeName = 'YouTube';
                var cover = getYouTubeCover(item.url);
                if (cover) thumbHtml = '<img class="video-preview-thumb" src="' + escapeAttr(cover) + '" alt="" />';
            }
            else if (v.type === 'file') {
                typeName = '视频文件';
                if (!item.isTemp) {
                    thumbHtml = '<video class="video-preview-thumb" src="' + escapeAttr(item.url) + '" preload="metadata" muted></video>';
                }
            }
        }
        if (!thumbHtml) {
            thumbHtml = '<div class="video-preview-thumb" style="display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.7rem;">' + typeName.charAt(0) + '</div>';
        }
        var name = item.isTemp ? (item.file ? item.file.name : '临时视频') : item.url.split('/').pop().split('?')[0];
        return '<div class="video-preview-item">' +
            thumbHtml +
            '<div class="video-preview-info">' +
            '<div class="video-preview-name">' + escapeHtml(name) + '</div>' +
            '<div class="video-preview-type">' + typeName + '</div>' +
            '</div>' +
            '<button class="video-preview-remove" onclick="removeVideo(' + idx + ')">\u00D7</button>' +
            '</div>';
    }).join('');
}

function removeVideo(idx) {
    editingVideos.splice(idx, 1);
    renderVideoPreviews();
}

function handleVideoFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        var url = URL.createObjectURL(file);
        editingVideos.push({ url: url, isTemp: true, file: file });
        renderVideoPreviews();
    });
    e.target.value = '';
}

function toggleSection(sectionId) {
    const section = $(sectionId);
    const toggle = section.querySelector('.toggle-switch');
    section.classList.toggle('collapsed');
    toggle.classList.toggle('on');
}

async function saveSlide() {
    const title = $('slide-title').value.trim();
    if (!title) {
        $('slide-title').classList.add('shake');
        setTimeout(() => $('slide-title').classList.remove('shake'), 400);
        return;
    }

    const unit = appData.units.find(u => u.id === editingUnitId);
    if (!unit) return;
    if (!unit.slides) unit.slides = [];

    const btn = $('btn-save-slide');
    if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }

    const slide = { title: title, images: [], videos: [], audio: null, text: null };
    let bar = $('slide-upload-progress');

    try {
        // 收集所有待上传文件，计算总字节数用于整体进度
        const tempFiles = [];
        if (!$('section-image').classList.contains('collapsed')) {
            const urlInput = $('slide-image-url');
            const urlText = urlInput ? urlInput.value.trim() : '';
            if (urlText) {
                const urlImages = urlText.split('\n').map(s => s.trim()).filter(Boolean);
                urlImages.forEach(url => editingImages.push({ url: url, isExisting: true }));
            }
            editingImages.forEach(item => { if (item.isTemp && item.file) tempFiles.push(item.file); });
        }
        if (!$('section-video').classList.contains('collapsed')) {
            const urlInput = $('slide-video-url');
            const urlText = urlInput ? urlInput.value.trim() : '';
            if (urlText) {
                const urlVideos = urlText.split('\n').map(s => s.trim()).filter(Boolean);
                urlVideos.forEach(url => editingVideos.push({ url: url, isExisting: true }));
            }
            editingVideos.forEach(item => { if (item.isTemp && item.file) tempFiles.push(item.file); });
        }
        if (!$('section-audio').classList.contains('collapsed')) {
            const fileInput = $('slide-audio-file');
            if (fileInput && fileInput.files[0]) tempFiles.push(fileInput.files[0]);
        }
        const totalBytes = tempFiles.reduce((s, f) => s + (f.size || 0), 0);
        let doneBytes = 0;
        if (bar) { bar.style.display = 'block'; updateProgress(bar, 0); }

        // 上传单个文件并更新整体进度
        async function runTask(file, folder) {
            const url = await uploadFile(file, folder, (ev) => {
                if (bar && ev.lengthComputable) {
                    const pct = totalBytes ? (doneBytes + ev.loaded) / totalBytes * 100 : 0;
                    updateProgress(bar, pct);
                    if (btn) btn.textContent = '上传中 ' + Math.round(pct) + '%';
                }
            });
            doneBytes += (file.size || 0);
            if (bar) updateProgress(bar, totalBytes ? doneBytes / totalBytes * 100 : 100);
            return url;
        }

        // 图片
        if (!$('section-image').classList.contains('collapsed')) {
            for (let i = 0; i < editingImages.length; i++) {
                const item = editingImages[i];
                if (item.isTemp && item.file) {
                    const uploadedUrl = await runTask(item.file, 'images');
                    slide.images.push(uploadedUrl);
                } else if (item.isExisting) {
                    slide.images.push(item.url);
                }
            }
        }

        // 视频
        if (!$('section-video').classList.contains('collapsed')) {
            for (let i = 0; i < editingVideos.length; i++) {
                const item = editingVideos[i];
                if (item.isTemp && item.file) {
                    const uploadedUrl = await runTask(item.file, 'videos');
                    slide.videos.push(uploadedUrl);
                } else if (item.isExisting) {
                    slide.videos.push(item.url);
                }
            }
        }

        // 音频
        if (!$('section-audio').classList.contains('collapsed')) {
            const fileInput = $('slide-audio-file');
            const urlInput = $('slide-audio-url');
            if (fileInput && fileInput.files[0]) {
                slide.audio = await runTask(fileInput.files[0], 'audios');
            } else if (urlInput && urlInput.value.trim()) {
                slide.audio = urlInput.value.trim();
            } else if (isEditing) {
                const old = unit.slides.find(s => s.id === editingSlideId);
                slide.audio = old ? old.audio : null;
            }
        }

        // 文字
        if (!$('section-text').classList.contains('collapsed')) {
            slide.text = $('slide-text').value;
        }

        // 保存到云端
        if (btn) btn.textContent = '保存中...';
        const saved = await dbSaveSlide(slide, editingUnitId, isEditing, editingSlideId);

        if (isEditing) {
            const idx = unit.slides.findIndex(s => s.id === editingSlideId);
            if (idx >= 0) unit.slides[idx] = saved;
        } else {
            unit.slides.push(saved);
        }

        closeModal();
        renderAdminUnits();
        if (bar) { updateProgress(bar, 100); setTimeout(() => { bar.style.display = 'none'; }, 400); }
        showToast(isEditing ? '已保存' : '页面已添加', 'success');
    } catch (e) {
        if (bar) bar.style.display = 'none';
        showToast('保存失败：' + (e.message || '网络错误'), 'error');
        if (btn) { btn.textContent = isEditing ? '保存' : '添加'; btn.disabled = false; }
    }
}

async function deleteSlide(unitId, slideId) {
    if (!confirm('确定删除这个页面吗？')) return;
    try {
        await dbDeleteSlide(slideId);
        const unit = appData.units.find(u => u.id === unitId);
        if (unit) {
            unit.slides = (unit.slides || []).filter(s => s.id !== slideId);
        }
        renderAdminUnits();
        showToast('页面已删除', 'success');
    } catch (e) {
        showToast('删除失败：' + (e.message || '网络错误'), 'error');
    }
}

// ====== 弹窗控制 ======
function openModal() { $('modal-overlay').classList.add('show'); }
function closeModal() {
    $('modal-overlay').classList.remove('show');
    editingUnitId = null;
    editingSlideId = null;
    isEditing = false;
    editingImages = [];
    editingVideos = [];
}

// ====== 修改密码 ======
function showPasswordModal() {
    $('modal-title').textContent = '修改登录密码';
    $('modal-body').innerHTML = `
        <div class="form-group">
            <label>新密码</label>
            <input type="text" id="new-password" value="${escapeHtml(appData.password)}" />
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="savePassword()">保存</button>
        </div>
    `;
    openModal();
}

async function savePassword() {
    const pwd = $('new-password').value.trim();
    if (!pwd) return;

    const btn = $('modal-body').querySelector('.btn-primary');
    if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }

    try {
        await dbUpdatePassword(pwd);
        appData.password = pwd;
        closeModal();
        showToast('密码已更新', 'success');
    } catch (e) {
        showToast('保存失败：' + (e.message || '网络错误'), 'error');
        if (btn) { btn.textContent = '保存'; btn.disabled = false; }
    }
}

// ====== 文件管理 ======
const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB
const STORAGE_FOLDERS = [
    { name: 'images', label: '图片', icon: '\u{1F5BC}' },
    { name: 'videos', label: '视频', icon: '\u{1F3AC}' },
    { name: 'audios', label: '音频', icon: '\u{1F3B5}' },
    { name: 'textbook', label: '教材', icon: '\u{1F4D6}' }
];

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function getFileIcon(filename) {
    var ext = (filename.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '\u{1F5BC}';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return '\u{1F3AC}';
    if (['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) return '\u{1F3B5}';
    if (['pdf'].includes(ext)) return '\u{1F4D5}';
    return '\u{1F4C4}';
}

function getFileExt(filename) {
    return (filename.split('.').pop() || '').toUpperCase();
}

async function showFileManager() {
    switchScreen('file-manager-screen');
    var container = $('file-list-container');
    container.innerHTML = '<div class="file-empty">正在加载文件列表...</div>';
    $('storage-used').textContent = '...';
    $('storage-remaining').textContent = '...';
    $('storage-count').textContent = '...';
    $('storage-bar-fill').style.width = '0%';
    $('storage-bar-text').textContent = '...';

    try {
        var allFiles = [];
        var totalSize = 0;
        var total_count = 0;

        for (var i = 0; i < STORAGE_FOLDERS.length; i++) {
            var folder = STORAGE_FOLDERS[i];
            var offset = 0;
            var hasMore = true;

            while (hasMore) {
                var result = await sb.storage.from('media').list(folder.name, {
                    limit: 1000,
                    offset: offset,
                    sortBy: { column: 'created_at', order: 'desc' }
                });

                if (result.error) throw result.error;
                var items = (result.data || []).filter(function(f) {
                    return f.name && !f.name.endsWith('.emptyFolderPlaceholder');
                });

                items.forEach(function(f) {
                    var size = (f.metadata && f.metadata.size) ? f.metadata.size : 0;
                    allFiles.push({
                        name: f.name,
                        folder: folder.name,
                        folderLabel: folder.label,
                        folderIcon: folder.icon,
                        size: size,
                        created_at: f.created_at,
                        mimetype: f.metadata ? f.metadata.mimetype : ''
                    });
                    totalSize += size;
                    total_count++;
                });

                hasMore = items.length === 1000;
                offset += 1000;
            }
        }

        // 更新存储概览
        var remaining = STORAGE_LIMIT_BYTES - totalSize;
        var percent = (totalSize / STORAGE_LIMIT_BYTES * 100);

        $('storage-used').textContent = formatFileSize(totalSize);
        $('storage-remaining').textContent = formatFileSize(Math.max(0, remaining));
        $('storage-count').textContent = total_count + ' 个';
        $('storage-bar-fill').style.width = Math.min(100, percent) + '%';
        $('storage-bar-text').textContent = percent.toFixed(1) + '%';

        var barFill = $('storage-bar-fill');
        barFill.classList.remove('warning', 'danger');
        if (percent > 80) barFill.classList.add('danger');
        else if (percent > 60) barFill.classList.add('warning');

        // 渲染文件列表
        renderFileList(allFiles, totalSize);

    } catch (e) {
        container.innerHTML = '<div class="file-empty">加载失败：' + escapeHtml(e.message || '未知错误') + '</div>';
        $('storage-used').textContent = '加载失败';
        $('storage-remaining').textContent = '-';
        $('storage-count').textContent = '-';
        $('storage-bar-text').textContent = '-';
    }
}

function renderFileList(files, totalSize) {
    var container = $('file-list-container');

    if (files.length === 0) {
        container.innerHTML = '<div class="file-empty">还没有上传任何文件</div>';
        return;
    }

    // 按文件夹分组
    var html = '';
    STORAGE_FOLDERS.forEach(function(folder) {
        var folderFiles = files.filter(function(f) { return f.folder === folder.name; });
        if (folderFiles.length === 0) return;

        var folderSize = folderFiles.reduce(function(sum, f) { return sum + f.size; }, 0);

        html += '<div class="file-folder-group">';
        html += '<div class="file-folder-header">';
        html += '<span class="folder-icon">' + folder.icon + '</span>';
        html += '<span>' + folder.label + '</span>';
        html += '<span class="folder-count">' + folderFiles.length + ' 个文件 · ' + formatFileSize(folderSize) + '</span>';
        html += '</div>';

        folderFiles.forEach(function(f) {
            var path = f.folder + '/' + f.name;
            var dateStr = '';
            if (f.created_at) {
                var d = new Date(f.created_at);
                dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            }
            var thumbHtml = '';
            var ext = getFileExt(f.name);
            if (folder.name === 'images') {
                var publicUrl = SUPABASE_URL + '/storage/v1/object/public/media/' + path;
                thumbHtml = '<img class="file-item-thumb" src="' + escapeAttr(publicUrl) + '" alt="" loading="lazy" />';
            } else {
                thumbHtml = '<div class="file-item-icon">' + getFileIcon(f.name) + '</div>';
            }

            html += '<div class="file-item">';
            html += thumbHtml;
            html += '<div class="file-item-info">';
            html += '<div class="file-item-name">' + escapeHtml(f.name) + '</div>';
            html += '<div class="file-item-meta">' + formatFileSize(f.size) + ' · ' + ext + (dateStr ? ' · ' + dateStr : '') + '</div>';
            html += '</div>';
            html += '<button class="file-item-preview" onclick="previewFile(\'' + escapeAttr(f.folder) + '\', \'' + escapeAttr(f.name) + '\', \'' + escapeAttr(f.mimetype || '') + '\')">预览</button>';
            html += '<button class="file-item-delete" onclick="deleteStorageFile(\'' + escapeAttr(f.folder) + '\', \'' + escapeAttr(f.name) + '\')">删除</button>';
            html += '</div>';
        });

        html += '</div>';
    });

    container.innerHTML = html;
}

async function deleteStorageFile(folder, filename) {
    if (!confirm('确定删除文件 "' + filename + '" 吗？\n删除后无法恢复，且引用此文件的内容将无法正常显示。')) return;

    var path = folder + '/' + filename;
    try {
        var result = await sb.storage.from('media').remove([path]);
        if (result.error) throw result.error;

        showToast('文件已删除', 'success');
        // 刷新文件列表
        showFileManager();
    } catch (e) {
        showToast('删除失败：' + (e.message || '网络错误'), 'error');
    }
}

// ====== 文件预览 ======
function filePublicUrl(folder, name) {
    return SUPABASE_URL + '/storage/v1/object/public/media/' + folder + '/' + name;
}

var IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
var VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
var AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a'];

function previewFile(folder, name, mimetype) {
    var url = filePublicUrl(folder, name);
    var ext = getFileExt(name).toLowerCase();
    var type = (mimetype || '').toLowerCase();
    var mediaHtml = '';

    if (IMAGE_EXTS.includes(ext) || type.indexOf('image/') === 0) {
        mediaHtml = '<img class="file-preview-media" src="' + escapeAttr(url) + '" alt="' + escapeAttr(name) + '">';
    } else if (VIDEO_EXTS.includes(ext) || type.indexOf('video/') === 0) {
        mediaHtml = '<video class="file-preview-media" controls autoplay src="' + escapeAttr(url) + '"></video>';
    } else if (AUDIO_EXTS.includes(ext) || type.indexOf('audio/') === 0) {
        mediaHtml = '<audio class="file-preview-media" controls autoplay src="' + escapeAttr(url) + '"></audio>';
    } else if (ext === 'pdf' || type === 'application/pdf') {
        mediaHtml = '<iframe class="file-preview-media" src="' + escapeAttr(url) + '"></iframe>';
    } else {
        mediaHtml = '<div class="file-preview-fallback">' +
            '<div class="file-preview-fallback-icon">' + getFileIcon(name) + '</div>' +
            '<div class="file-preview-fallback-name">' + escapeHtml(name) + '</div>' +
            '<a class="btn btn-primary" href="' + escapeAttr(url) + '" target="_blank" rel="noopener">打开 / 下载</a>' +
            '</div>';
    }

    $('file-preview-media').innerHTML = mediaHtml;
    $('file-preview-title').textContent = name;
    $('file-preview-overlay').classList.add('show');
}

function closeFilePreview() {
    var o = $('file-preview-overlay');
    o.classList.remove('show');
    $('file-preview-media').innerHTML = '';
}

// ====== 触摸滑动 ======
let touchStartX = 0, touchEndX = 0;

document.addEventListener('touchstart', e => {
    if (!$('presentation-screen').classList.contains('active')) return;
    if (ivIsOpen()) return;
    if ($('video-modal-overlay').classList.contains('show')) return;
    touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
    if (!$('presentation-screen').classList.contains('active')) return;
    if (ivIsOpen()) return;
    if ($('video-modal-overlay').classList.contains('show')) return;
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) > 50) { diff < 0 ? nextSlide() : prevSlide(); }
});

// ====== 沉浸式大图查看器触摸滑动切图 ======
let ivTouchStartX = 0;
document.addEventListener('touchstart', e => {
    if (!ivIsOpen()) return;
    ivTouchStartX = e.changedTouches[0].screenX;
});
document.addEventListener('touchend', e => {
    if (!ivIsOpen()) return;
    const diff = e.changedTouches[0].screenX - ivTouchStartX;
    if (Math.abs(diff) > 40) { diff < 0 ? ivNext() : ivPrev(); }
});

// ====== 顶部栏自动隐藏 ======
let topbarTimer = null;
function setupAutoHide() {
    const topbar = $('pres-topbar');
    const thumbBar = $('presentation-thumb-bar');
    if (!topbar) return;

    const show = () => {
        topbar.classList.remove('hidden');
        if (thumbBar) thumbBar.classList.remove('hidden');
        clearTimeout(topbarTimer);
        topbarTimer = setTimeout(() => {
            topbar.classList.add('hidden');
            if (thumbBar) thumbBar.classList.add('hidden');
        }, 3000);
    };

    document.addEventListener('mousemove', show);
    document.addEventListener('touchstart', show);
}

// ====== 初始化 ======
async function init() {
    $('btn-admin').addEventListener('click', showAdminPasswordModal);
    $('btn-logout').addEventListener('click', () => location.reload());

    $('btn-back-dashboard').addEventListener('click', () => {
        switchScreen('dashboard-screen');
        renderDashboard();
    });
    $('btn-add-unit').addEventListener('click', showAddUnitModal);
    $('btn-password').addEventListener('click', showPasswordModal);

    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    $('btn-files').addEventListener('click', showFileManager);
    $('btn-back-admin').addEventListener('click', () => {
        switchScreen('admin-screen');
        renderAdminUnits();
    });
    $('modal-close').addEventListener('click', closeModal);
    $('modal-overlay').addEventListener('click', e => {
        if (e.target === $('modal-overlay')) closeModal();
    });

    // 沉浸式大图查看器：小圆点按钮 + 点击两侧切图（带防抖），双击空白退出
    $('iv-fs').addEventListener('click', e => { e.stopPropagation(); ivToggleFullscreen(); });
    $('iv-close').addEventListener('click', e => { e.stopPropagation(); closeImmersiveViewer(); });
    document.addEventListener('mousemove', () => { if (ivIsOpen()) ivShowChrome(); });
    document.addEventListener('touchstart', () => { if (ivIsOpen()) ivShowChrome(); }, { passive: true });

    $('iv-stage').addEventListener('click', function(e) {
        if (!ivIsOpen()) return;
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const dir = x < rect.width * 0.28 ? -1 : (x > rect.width * 0.72 ? 1 : 0);
        if (!dir) return;
        clearTimeout(ivClickTimer);
        ivClickTimer = setTimeout(function() {
            if (!ivIsOpen()) return;
            if (dir < 0) ivPrev();
            else ivNext();
        }, 220);
    });
    $('iv-stage').addEventListener('dblclick', e => {
        if (ivIsOpen()) {
            e.preventDefault();
            clearTimeout(ivClickTimer);
            closeImmersiveViewer();
        }
    });

    // 视频弹窗点击背景关闭
    $('video-modal-overlay').addEventListener('click', e => {
        if (e.target === $('video-modal-overlay')) closeVideoModal();
    });

    setupAutoHide();

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if ($('video-modal-overlay').classList.contains('show')) { closeVideoModal(); return; }
            if (ivIsOpen()) { closeImmersiveViewer(); return; }
            if ($('modal-overlay').classList.contains('show')) closeModal();
        }
    });

    // 从云端加载数据，直接进入首页（无登录页）
    try {
        appData = await loadData();
        if (appData.units.length === 0) {
            await migrateDefaultData();
            appData = await loadData();
        }
        dataReady = true;
    } catch (e) {
        console.error('加载失败:', e);
    }
    switchScreen('dashboard-screen');
    renderDashboard();
}

document.addEventListener('DOMContentLoaded', init);
