/* ============================================
   音乐教学演示台 v4 — 浅色主题 + 多图 + 图片放大 + B站视频
   数据存储：Supabase (PostgreSQL + Storage)
   ============================================ */

// ====== Supabase 配置 ======
const SUPABASE_URL = 'https://dgffaxdaorwzsqyrkfxd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZmZheGRhb3J3enNxeXJrZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTcwOTYsImV4cCI6MjEwMDM5MzA5Nn0.NZ-4BIGMwhbFp-KUrV6e7hReBGyyRaSVdH7o07yOpB8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ====== 状态 ======
let appData = { password: '1234', units: [] };
let currentUnitIndex = -1;
let currentSlideIndex = 0;
let currentImageIndex = 0; // 当前显示的多图索引
let isEditing = false;
let editingUnitId = null;
let editingSlideId = null;
let dataReady = false;

// Lightbox 状态
let lightboxImages = [];
let lightboxIndex = 0;

// 临时存储编辑中的图片列表 [{url, isExisting}]
let editingImages = [];

// 临时存储编辑中的视频列表 [{url, isExisting, isTemp, file}]
let editingVideos = [];

// 画廊项队列（图片+视频统一管理）
let currentGalleryItems = [];

// Lightbox 切换锁（防止动画重叠）
let lbSwapping = false;

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
    // 图片点击 → 打开 Lightbox（仅包含图片，不含视频）
    container.querySelectorAll('img[data-full]').forEach(function(img) {
        img.addEventListener('click', function(e) {
            e.stopPropagation();
            var imageUrls = currentGalleryItems
                .filter(function(item) { return item.type === 'image'; })
                .map(function(item) { return item.url; });
            var idx = parseInt(this.getAttribute('data-idx') || '0');
            openLightbox(imageUrls.length > 0 ? imageUrls : [this.getAttribute('data-full')], Math.min(idx, Math.max(0, imageUrls.length - 1)));
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

async function uploadFile(file, folder) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const fileName = folder + '/' + Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '.' + ext;

    const { error } = await sb.storage.from('media').upload(fileName, file, { cacheControl: '3600' });
    if (error) throw error;

    const { data } = sb.storage.from('media').getPublicUrl(fileName);
    return data.publicUrl;
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

// ====== 登录页面动画 ======
function initLoginAnimations() {
    const waveform = $('login-waveform');
    if (waveform) {
        for (let i = 0; i < 80; i++) {
            const bar = document.createElement('div');
            bar.className = 'wave-bar';
            bar.style.animationDelay = (Math.random() * 1.2) + 's';
            bar.style.setProperty('--h', (8 + Math.random() * 50) + 'px');
            bar.style.animationDuration = (0.8 + Math.random() * 0.8) + 's';
            waveform.appendChild(bar);
        }
    }

    const particles = $('login-particles');
    if (particles) {
        const notes = ['\u266A', '\u266B', '\u266C', '\u2669', '\u266D', '\u266F'];
        for (let i = 0; i < 12; i++) {
            const note = document.createElement('span');
            note.className = 'float-note';
            note.textContent = notes[Math.floor(Math.random() * notes.length)];
            note.style.left = (Math.random() * 100) + '%';
            note.style.fontSize = (1.2 + Math.random() * 1.8) + 'rem';
            note.style.animationDelay = (Math.random() * 12) + 's';
            note.style.animationDuration = (10 + Math.random() * 8) + 's';
            particles.appendChild(note);
        }
    }
}

// ====== 登录 ======
function initLogin() {
    const btn = $('login-btn');
    btn.addEventListener('click', doLogin);
    const adminLink = $('login-admin-link');
    if (adminLink) adminLink.addEventListener('click', showAdminPasswordModal);
}

function doLogin() {
    const btn = $('login-btn');
    if (btn.disabled) return;
    btn.textContent = '进入中...';
    btn.disabled = true;
    setTimeout(function() {
        btn.textContent = '进入课堂';
        btn.disabled = false;
        switchScreen('dashboard-screen');
        renderDashboard();
    }, 300);
}

// ====== 仪表盘 ======
function renderDashboard() {
    const grid = $('units-grid');
    const empty = $('dashboard-empty');

    if (!appData.units || appData.units.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    grid.innerHTML = appData.units.map((unit, index) => {
        const slides = unit.slides || [];
        const icon = unit.icon || getUnitCoverIcon(slides);

        return `
            <div class="unit-card" data-index="${index}" style="animation-delay: ${index * 0.08}s" onclick="startPresentation(${index})">
                <div class="unit-card-cover">
                    <span class="unit-card-icon">${icon}</span>
                </div>
                <div class="unit-card-body">
                    <h3>${escapeHtml(unit.name)}</h3>
                </div>
            </div>
        `;
    }).join('');
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

// ====== 演示模式 ======
function startPresentation(unitIndex) {
    currentUnitIndex = unitIndex;
    currentSlideIndex = 0;
    currentImageIndex = 0;
    const unit = appData.units[unitIndex];
    const slides = unit.slides || [];

    $('presentation-title').textContent = unit.name;
    switchScreen('presentation-screen');
    renderSlide();
    setupPresentationControls();
}

function renderSlide() {
    const unit = appData.units[currentUnitIndex];
    const slides = unit.slides || [];
    if (currentSlideIndex < 0 || currentSlideIndex >= slides.length) return;

    const slide = slides[currentSlideIndex];
    const container = $('presentation-content');

    container.classList.remove('visible');
    currentImageIndex = 0;

    setTimeout(() => {
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

        requestAnimationFrame(() => container.classList.add('visible'));
    }, 400);
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

function nextSlide() {
    const unit = appData.units[currentUnitIndex];
    const slides = unit.slides || [];
    if (currentSlideIndex < slides.length - 1) { currentSlideIndex++; renderSlide(); }
}

function prevSlide() {
    if (currentSlideIndex > 0) { currentSlideIndex--; renderSlide(); }
}

function setupPresentationControls() {
    $('btn-prev').onclick = prevSlide;
    $('btn-next').onclick = nextSlide;
    $('btn-exit-presentation').onclick = exitPresentation;
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
        // 弹窗打开时不翻页
        if ($('lightbox').classList.contains('show')) return;
        if ($('video-modal-overlay').classList.contains('show')) return;

        // 点击到真正可交互的元素时不翻页；文字/留白区域均翻页
        var interactive = e.target.closest('img, video, audio, button, a, .video-cover-card, .image-thumb, .video-gallery-item, .slide-audio-block, textarea, input, .nav-dot, .presentation-bottombar, .presentation-thumb-bar, .presentation-topbar, .click-nav-hint, .toc-overlay, .toc-panel');
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

    // Lightbox 打开时
    if ($('lightbox').classList.contains('show')) {
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowRight') { e.preventDefault(); lightboxNext(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); lightboxPrev(); }
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
    const container = $('presentation-content');
    container.querySelectorAll('video, audio').forEach(m => { m.pause(); m.src = ''; });
    container.innerHTML = '';
    var thumbBar = $('presentation-thumb-bar');
    thumbBar.innerHTML = '';
    thumbBar.classList.remove('show');
    closeVideoModal();
    closeLightbox();
    closeToc();
    document.onkeydown = null;
    switchScreen('dashboard-screen');
    renderDashboard();
}

// ====== 目录浮层 ======
function openToc() {
    const unit = appData.units[currentUnitIndex];
    const slides = unit.slides || [];
    const list = $('toc-list');
    list.innerHTML = slides.map((slide, i) => {
        const label = (slide.title && slide.title.trim()) ? slide.title : ('第 ' + (i + 1) + ' 页');
        const thumb = (slide.images && slide.images[0])
            ? '<img class="toc-thumb" src="' + escapeHtml(slide.images[0]) + '" alt="" loading="lazy">'
            : '';
        return '<button class="toc-item' + (i === currentSlideIndex ? ' active' : '') + '" data-idx="' + i + '">' +
            '<span class="toc-index">' + (i + 1) + '</span>' +
            thumb +
            '<span class="toc-label">' + escapeHtml(label) + '</span>' +
            '</button>';
    }).join('');
    list.querySelectorAll('.toc-item').forEach(function(item) {
        item.addEventListener('click', function() {
            const idx = parseInt(this.getAttribute('data-idx'));
            closeToc();
            goToSlide(idx);
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

// ====== 图片放大（Lightbox） ======
function openLightbox(images, index) {
    lightboxImages = images || [];
    lightboxIndex = index || 0;
    lbSwapping = false;

    // 首次打开：直接设置图片，无需淡出
    var img = $('lightbox-img');
    img.src = lightboxImages[lightboxIndex] || '';
    img.style.opacity = '1';
    img.style.transform = 'scale(1)';

    updateLightboxNav();
    $('lightbox').classList.add('show');
}

function updateLightboxNav() {
    var counter = $('lightbox-counter');
    var prevBtn = $('lightbox-prev');
    var nextBtn = $('lightbox-next');

    if (lightboxImages.length > 1) {
        counter.style.display = 'block';
        counter.textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length;
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
    } else {
        counter.style.display = 'none';
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    }
}

function updateLightboxImage() {
    var img = $('lightbox-img');
    if (!lightboxImages.length || lbSwapping) return;

    lbSwapping = true;

    // 淡出当前图片
    img.style.opacity = '0';
    img.style.transform = 'scale(0.95)';

    setTimeout(function() {
        var newSrc = lightboxImages[lightboxIndex];

        // 预加载新图片，加载完成后再显示
        var preloader = new Image();
        preloader.onload = function() {
            img.src = newSrc;
            requestAnimationFrame(function() {
                img.style.opacity = '1';
                img.style.transform = 'scale(1)';
                lbSwapping = false;
            });
        };
        preloader.onerror = function() {
            img.src = newSrc;
            img.style.opacity = '1';
            img.style.transform = 'scale(1)';
            lbSwapping = false;
        };
        preloader.src = newSrc;

        // 超时兜底：2秒后强制显示
        setTimeout(function() {
            if (lbSwapping) {
                img.src = newSrc;
                img.style.opacity = '1';
                img.style.transform = 'scale(1)';
                lbSwapping = false;
            }
        }, 2000);
    }, 300);

    updateLightboxNav();
}

function lightboxNext() {
    if (lightboxImages.length <= 1) return;
    lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
    updateLightboxImage();
}

function lightboxPrev() {
    if (lightboxImages.length <= 1) return;
    lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
    updateLightboxImage();
}

function closeLightbox() {
    var lb = $('lightbox');
    lb.classList.remove('show');
    lbSwapping = false;
    setTimeout(function() { $('lightbox-img').src = ''; }, 300);
}

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
                        <button class="btn-add-item" onclick="addSlide('${unit.id}')">+ 添加页面</button>
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
        const coverSlide = { id: generateId(), title: name, text: coverText, images: [], videos: [], audio: null };
        const savedCover = await dbSaveSlide(coverSlide, newUnit.id, false, null);
        newUnit.slides = [savedCover];
        appData.units.push(newUnit);
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
            // 同步更新封面页（第一张 slide）的标题与正文
            if (!unit.slides) unit.slides = [];
            if (unit.slides.length === 0) {
                const coverSlide = { id: generateId(), title: name, text: coverText, images: [], videos: [], audio: null };
                const saved = await dbSaveSlide(coverSlide, unitId, false, null);
                unit.slides.push(saved);
            } else {
                const cover = unit.slides[0];
                const updated = { ...cover, title: name, text: coverText };
                const saved = await dbSaveSlide(updated, unitId, true, cover.id);
                unit.slides[0] = saved;
            }
        }
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

    try {
        // 图片
        if (!$('section-image').classList.contains('collapsed')) {
            const urlInput = $('slide-image-url');
            const urlText = urlInput ? urlInput.value.trim() : '';

            // 先加上 URL 输入框的图片
            if (urlText) {
                const urlImages = urlText.split('\n').map(s => s.trim()).filter(Boolean);
                urlImages.forEach(url => editingImages.push({ url: url, isExisting: true }));
            }

            // 上传临时文件
            for (let i = 0; i < editingImages.length; i++) {
                const item = editingImages[i];
                if (item.isTemp && item.file) {
                    if (btn) btn.textContent = '上传图片 ' + (i + 1) + '/' + editingImages.filter(x => x.isTemp).length + '...';
                    const uploadedUrl = await uploadFile(item.file, 'images');
                    slide.images.push(uploadedUrl);
                } else if (item.isExisting) {
                    slide.images.push(item.url);
                }
            }
        }

        // 视频
        if (!$('section-video').classList.contains('collapsed')) {
            const urlInput = $('slide-video-url');
            const urlText = urlInput ? urlInput.value.trim() : '';

            // 先加上 URL 输入框的视频
            if (urlText) {
                const urlVideos = urlText.split('\n').map(s => s.trim()).filter(Boolean);
                urlVideos.forEach(url => editingVideos.push({ url: url, isExisting: true }));
            }

            // 上传临时文件
            for (let i = 0; i < editingVideos.length; i++) {
                const item = editingVideos[i];
                if (item.isTemp && item.file) {
                    if (btn) btn.textContent = '上传视频 ' + (i + 1) + '/' + editingVideos.filter(x => x.isTemp).length + '...';
                    const uploadedUrl = await uploadFile(item.file, 'videos');
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
                if (btn) btn.textContent = '上传音频...';
                slide.audio = await uploadFile(fileInput.files[0], 'audios');
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
        showToast(isEditing ? '已保存' : '页面已添加', 'success');
    } catch (e) {
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

// ====== 触摸滑动 ======
let touchStartX = 0, touchEndX = 0;

document.addEventListener('touchstart', e => {
    if (!$('presentation-screen').classList.contains('active')) return;
    if ($('lightbox').classList.contains('show')) return;
    if ($('video-modal-overlay').classList.contains('show')) return;
    touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
    if (!$('presentation-screen').classList.contains('active')) return;
    if ($('lightbox').classList.contains('show')) return;
    if ($('video-modal-overlay').classList.contains('show')) return;
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) > 50) { diff < 0 ? nextSlide() : prevSlide(); }
});

// ====== Lightbox 触摸滑动切图 ======
let lbTouchStartX = 0, lbTouchEndX = 0;
document.addEventListener('touchstart', e => {
    if (!$('lightbox').classList.contains('show')) return;
    lbTouchStartX = e.changedTouches[0].screenX;
});
document.addEventListener('touchend', e => {
    if (!$('lightbox').classList.contains('show')) return;
    lbTouchEndX = e.changedTouches[0].screenX;
    const diff = lbTouchEndX - lbTouchStartX;
    if (Math.abs(diff) > 40) { diff < 0 ? lightboxNext() : lightboxPrev(); }
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
    initLoginAnimations();
    initLogin();

    $('btn-admin').addEventListener('click', showAdminPasswordModal);
    $('btn-logout').addEventListener('click', () => {
        switchScreen('login-screen');
    });

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

    // Lightbox 点击背景关闭
    $('lightbox').addEventListener('click', e => {
        if (e.target === $('lightbox') || e.target === $('lightbox-img')) closeLightbox();
    });

    // 视频弹窗点击背景关闭
    $('video-modal-overlay').addEventListener('click', e => {
        if (e.target === $('video-modal-overlay')) closeVideoModal();
    });

    setupAutoHide();

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if ($('video-modal-overlay').classList.contains('show')) { closeVideoModal(); return; }
            if ($('lightbox').classList.contains('show')) { closeLightbox(); return; }
            if ($('modal-overlay').classList.contains('show')) closeModal();
        }
    });

    // 从云端加载数据
    const loginHint = $('login-hint');
    const loginBtn = $('login-btn');
    loginBtn.disabled = true;
    loginBtn.textContent = '正在连接云端...';
    if (loginHint) loginHint.textContent = '';

    try {
        appData = await loadData();

        if (appData.units.length === 0) {
            if (loginHint) loginHint.textContent = '首次使用，正在导入教材内容...';
            await migrateDefaultData();
            appData = await loadData();
        }

        dataReady = true;
        loginBtn.disabled = false;
        loginBtn.textContent = '进入课堂';
        if (loginHint) loginHint.textContent = '';
    } catch (e) {
        console.error('加载失败:', e);
        loginBtn.disabled = false;
        loginBtn.textContent = '进入课堂';
        if (loginHint) loginHint.textContent = '云端连接失败，请检查网络后刷新重试';
    }}

document.addEventListener('DOMContentLoaded', init);
