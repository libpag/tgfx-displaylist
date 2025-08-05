
const translations = {
    en: {
        language: "Language",
        selectFile: "Select File",
        renderMode: "Render Mode",
        direct: "Direct",
        partial: "Partial",
        tile: "Tile",
        tileOptions: "Tile Options",
        tileSize: "Tile Size",
        maxTiles: "Max Tiles",
        allowBlur: "Allow Blur",
        maxUpdates: "Max Updates Per Frame",
        showDirtyRects: "Show Dirty Rects",
        zoomIn: "Zoom In",
        zoomOut: "Zoom Out",
        fitView: "Fit View",
        yes: "Yes",
        no: "No"
    },
    zh: {
        language: "语言",
        selectFile: "选择文件",
        renderMode: "渲染模式",
        direct: "直接渲染",
        partial: "部分渲染",
        tile: "瓦片渲染",
        tileOptions: "瓦片选项",
        tileSize: "瓦片大小",
        maxTiles: "最大瓦片数",
        allowBlur: "允许模糊",
        maxUpdates: "每帧最大更新数",
        showDirtyRects: "显示脏矩形",
        zoomIn: "放大",
        zoomOut: "缩小",
        fitView: "适应视图",
        yes: "是",
        no: "否"
    }
};

let currentLang = 'auto';

function detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage;
    return browserLang.startsWith('zh') ? 'zh' : 'en';
}


function applyInitialLanguage() {
    const langToUse = detectBrowserLanguage();
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        langSelect.value = 'auto'; 
    }
    updateTexts(); 
    
}

function updateTexts() {
    const langToUse = currentLang === 'auto' ? detectBrowserLanguage() : currentLang;
    const lang = translations[langToUse];
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (lang[key]) {
            if (el.tagName === 'INPUT' && el.type === 'checkbox') {
                el.nextElementSibling.textContent = lang[key];
            } else {
                el.textContent = lang[key];
            }
        }
    });
    
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        
        
        langSelect.options[0].text = '自动（auto）';
        langSelect.options[1].text = 'English';
        langSelect.options[2].text = 'Chinese';
    }
    
    const blurSelect = document.getElementById('allowBlur');
    if (blurSelect) {
        blurSelect.options[0].text = lang['yes'];
        blurSelect.options[1].text = lang['no'];
    }
    
    const renderModeSelect = document.getElementById('renderModeSelect');
    if (renderModeSelect) {
        Array.from(renderModeSelect.options).forEach(option => {
            const key = option.getAttribute('data-translate');
            if (key && lang[key]) {
                option.text = lang[key];
            }
        });
    }
    
    const dirtyRectSelect = document.getElementById('showDirtyRect');
    if (dirtyRectSelect) {
        dirtyRectSelect.options[0].text = lang['yes'];
        dirtyRectSelect.options[1].text = lang['no'];
    }
    
    const zoomValue = document.getElementById('zoomValue');
    if (zoomValue) {
        const percentText = currentLang === 'zh' ? '%' : '%';
        zoomValue.textContent = zoomValue.textContent.replace('%', percentText);
    }
}

function initLanguageSwitcher() {
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;
    
    languageSelect.addEventListener('change', function() {
        currentLang = this.value;
       
        
        if (currentLang === 'auto') {
            updateTexts();
        } else {
            updateTexts();
        }
    });
    
    languageSelect.value = currentLang;
}

function initApp() {
    applyInitialLanguage(); 
    initLanguageSwitcher();
    
    document.getElementById('fileSelect').addEventListener('change', function() {
        document.dispatchEvent(new Event('change'));
    });
    
    document.getElementById('tileSizeSelect').addEventListener('change', function() {
        document.dispatchEvent(new Event('change'));
    });

    var renderModeSelect = document.getElementById('renderModeSelect');
    var tileOptions = document.getElementById('tileOptions');
    
    function updateTileOptions() {
        if (renderModeSelect.value === 'tile') {
            tileOptions.classList.remove('hidden');
        } else {
            tileOptions.classList.add('hidden');
        }
    }
    
    renderModeSelect.addEventListener('change', updateTileOptions);
    updateTileOptions();

    var zoomWidget = document.getElementById('zoomWidget');
    var zoomDisplay = document.getElementById('zoomDisplay');
    var zoomDropdown = document.getElementById('zoomDropdown');
    var zoomValue = document.getElementById('zoomValue');
    var zoomInput = document.getElementById('zoomInput');
    var currentZoom = 100;

    function setZoom(val) {
        val = Math.max(1, Math.min(2000, Math.round(val)));
        currentZoom = val;
        zoomValue.textContent = val + '%';
        zoomInput.value = val;
    }

    function validateInput(input, min, max) {
        input.addEventListener('change', function() {
            var value = parseInt(this.value);
            if (isNaN(value)) value = min;
            this.value = Math.max(min, Math.min(max, value));
        });
    }

    validateInput(document.getElementById('maxTileCount'), 1, 100);
    validateInput(document.getElementById('maxUpdatePerFrame'), 1, 100);
    validateInput(zoomInput, 1, 2000);
    
    document.getElementById('allowBlur').addEventListener('change', function() {
        document.dispatchEvent(new Event('change'));
    });

    zoomDisplay.addEventListener('click', function() {
        var isExpanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !isExpanded);
        zoomDropdown.classList.toggle('show');
    });

    document.addEventListener('mousedown', function(e) {
        if (zoomWidget && !zoomWidget.contains(e.target)) {
            zoomDisplay.setAttribute('aria-expanded', 'false');
            zoomDropdown.classList.remove('show');
        }
    });

    document.querySelectorAll('.zoom-option[data-zoom]').forEach(function(opt) {
        opt.addEventListener('click', function() {
            var type = this.getAttribute('data-zoom');
            if (type === 'in') setZoom(currentZoom + 10);
            else if (type === 'out') setZoom(currentZoom - 10);
            else if (type === 'fit') setZoom(100);
            else setZoom(Number(type));
            zoomDropdown.classList.remove('show');
        });
    });

    zoomInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            setZoom(Number(zoomInput.value));
            zoomDropdown.classList.remove('show');
        }
    });

    setZoom(100);
}

document.addEventListener('DOMContentLoaded', initApp);
