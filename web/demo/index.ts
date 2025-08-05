
// 定义翻译内容的接口
interface Translation {
    [key: string]: string;
}

const translations = {
    en: {
        language: "Language",
        selectFile: "Select File",
        renderMode: "Render Mode",
        direct: "Direct",
        partial: "Partial",
        tile: "Tile",
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

let currentLang: 'auto' | 'en' | 'zh' = 'auto';

// 检测浏览器语言
function detectBrowserLanguage(): 'zh' | 'en' {
    const browserLang = navigator.language || (navigator as any).userLanguage;
    return browserLang.startsWith('zh') ? 'zh' : 'en';
}

// 应用初始语言设置
function applyInitialLanguage() {
    const langSelect = document.getElementById('languageSelect') as HTMLSelectElement | null;
    if (langSelect) {
        langSelect.value = 'auto';
    }
    updateTexts();
}

// 更新页面文本
function updateTexts() {
    const langToUse = currentLang === 'auto' ? detectBrowserLanguage() : currentLang;
    const lang = translations[langToUse];
    
    document.querySelectorAll<HTMLElement>('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (key && lang[key]) {
            if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.nextElementSibling) {
                (el.nextElementSibling as HTMLElement).textContent = lang[key];
            } else {
                el.textContent = lang[key];
            }
        }
    });

    const updateSelectOptions = (selectId: string, options: string[]) => {
        const select = document.getElementById(selectId) as HTMLSelectElement | null;
        if (select) {
            options.forEach((text, index) => {
                if (select.options[index]) {
                    select.options[index].text = text;
                }
            });
        }
    };

    updateSelectOptions('languageSelect', ['自动（auto）', 'English', 'Chinese']);
    updateSelectOptions('allowBlur', [lang['yes'], lang['no']]);
    updateSelectOptions('showDirtyRect', [lang['yes'], lang['no']]);

    const renderModeSelect = document.getElementById('renderModeSelect') as HTMLSelectElement | null;
    if (renderModeSelect) {
        Array.from(renderModeSelect.options).forEach(option => {
            const key = option.getAttribute('data-translate');
            if (key && lang[key]) {
                option.text = lang[key];
            }
        });
    }

    const zoomValue = document.getElementById('zoomValue');
    if (zoomValue) {
        zoomValue.textContent = zoomValue.textContent?.replace('%', '%') || '';
    }
}

// 初始化语言切换器
function initLanguageSwitcher() {
    const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement | null;
    if (!languageSelect) return;
    
    languageSelect.addEventListener('change', function() {
        currentLang = this.value as 'auto' | 'en' | 'zh';
        updateTexts();
    });
    
    languageSelect.value = currentLang;
}

// 初始化应用
function initApp() {
    applyInitialLanguage();
    initLanguageSwitcher();

    const addChangeListener = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                document.dispatchEvent(new Event('change'));
            });
        }
    };

    addChangeListener('fileSelect');
    addChangeListener('tileSizeSelect');
    addChangeListener('allowBlur');

    const renderModeSelect = document.getElementById('renderModeSelect') as HTMLSelectElement | null;
    const tileOptions = document.getElementById('tileOptions');

    if (renderModeSelect && tileOptions) {
        const updateTileOptions = () => {
            tileOptions.classList.toggle('hidden', renderModeSelect.value !== 'tile');
        };
        renderModeSelect.addEventListener('change', updateTileOptions);
        updateTileOptions();
    }

    let currentZoom = 100;
    const zoomInput = document.getElementById('zoomInput') as HTMLInputElement | null;
    const zoomValue = document.getElementById('zoomValue');
    const zoomDropdown = document.getElementById('zoomDropdown');
    const zoomDisplay = document.getElementById('zoomDisplay');

    const setZoom = (val: number) => {
        val = Math.max(1, Math.min(2000, Math.round(val)));
        currentZoom = val;
        if (zoomValue) zoomValue.textContent = `${val}%`;
        if (zoomInput) zoomInput.value = val.toString();
    };

    const validateInput = (input: HTMLInputElement, min: number, max: number) => {
        input.addEventListener('change', function() {
            let value = parseInt(this.value);
            if (isNaN(value)) value = min;
            this.value = Math.max(min, Math.min(max, value)).toString();
        });
    };

    const inputs = [
        { id: 'maxTileCount', min: 1, max: 100 },
        { id: 'maxUpdatePerFrame', min: 1, max: 100 },
        { id: 'zoomInput', min: 1, max: 2000 }
    ];

    inputs.forEach(({ id, min, max }) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input) validateInput(input, min, max);
    });

    if (zoomDisplay && zoomDropdown) {
        zoomDisplay.addEventListener('click', () => {
            const isExpanded = zoomDisplay.getAttribute('aria-expanded') === 'true';
            zoomDisplay.setAttribute('aria-expanded', (!isExpanded).toString());
            zoomDropdown.classList.toggle('show');
        });
    }

    document.addEventListener('mousedown', (e) => {
        const zoomWidget = document.getElementById('zoomWidget');
        if (zoomWidget && !zoomWidget.contains(e.target as Node)) {
            if (zoomDisplay) zoomDisplay.setAttribute('aria-expanded', 'false');
            if (zoomDropdown) zoomDropdown.classList.remove('show');
        }
    });

    document.querySelectorAll<HTMLElement>('.zoom-option[data-zoom]').forEach(opt => {
        opt.addEventListener('click', () => {
            const type = opt.getAttribute('data-zoom');
            if (type === 'in') setZoom(currentZoom + 10);
            else if (type === 'out') setZoom(currentZoom - 10);
            else if (type === 'fit') setZoom(100);
            else setZoom(Number(type));
            if (zoomDropdown) zoomDropdown.classList.remove('show');
        });
    });

    if (zoomInput) {
        zoomInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                setZoom(Number(zoomInput.value));
                if (zoomDropdown) zoomDropdown.classList.remove('show');
            }
        });
    }

    setZoom(100);
}

document.addEventListener('DOMContentLoaded', initApp);