/////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Tencent is pleased to support the open source community by making tgfx-displaylist available.
//
//  Copyright (C) 2025 Tencent. All rights reserved.
//
//  Licensed under the BSD 3-Clause License (the "License"); you may not use this file except
//  in compliance with the License. You may obtain a copy of the License at
//
//      https://opensource.org/licenses/BSD-3-Clause
//
//  unless required by applicable law or agreed to in writing, software distributed under the
//  license is distributed on an "as is" basis, without warranties or conditions of any kind,
//  either express or implied. see the license for the specific language governing permissions
//  and limitations under the license.
//
/////////////////////////////////////////////////////////////////////////////////////////////////
import {TGFXBind} from '../lib/tgfx';
import * as types from '../types/types';

export class TGFXBaseView {
    public updateSize: (devicePixelRatio: number) => void;
    public draw: (drawIndex: number, zoom: number, offsetX: number, offsetY: number) => boolean;
    public setAllowBlur: (allowBlur: boolean) => void;
    public setShowDirtyRect: (isVisible: boolean) => void;
    public getDrawerNames: () => Promise<any>; // 返回Promise，可能是C++对象或数组
    public setImagePath: (name: string, imagePath: string) => void;

}


export class ShareData {
    public DisplaylistModule: types.TGFX = null;
    public tgfxBaseView: TGFXBaseView = null;
    public drawIndex: number = 0;
    public zoom: number = 1.0;
    public offsetX: number = 0;
    public offsetY: number = 0;
    public animationFrameId: number | null = null;
    public isPageVisible: boolean = true;
    public resized: boolean = true;
    public updateSizeTimer: number | null = null;
    public drawerNames: string[] = [];
}

export let shareData: ShareData;

const LANGUAGE_KEY = 'preferred_language';
const DEFAULT_LANGUAGE = 'auto';

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
        allowBlurYes: "Yes",
        allowBlurNo: "No",
        maxUpdates: "Max Updates Per Frame",
        showDirtyRects: "Show Dirty Rects",
        showDirtyRectYes: "Yes",
        showDirtyRectNo: "No",
        zoomIn: "Zoom In",
        zoomOut: "Zoom Out",
        fitView: "Fit View",
        autoOption: 'Auto',
        chineseOption: 'Chinese (CN)',
        englishOption: 'English (US)',
        desktopWarning: "This website only supports desktop browsers based on Chromium (like Chrome or Edge). Please switch to one of these browsers to access it.",
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
        allowBlurYes: "是",
        allowBlurNo: "否",
        maxUpdates: "每帧最大更新数",
        showDirtyRects: "显示脏矩形",
        showDirtyRectYes: "是",
        showDirtyRectNo: "否",
        zoomIn: "放大",
        zoomOut: "缩小",
        fitView: "适应视图",
        autoOption: "自动",
        chineseOption: "中文 (简体)",
        englishOption: "English (US)",
        desktopWarning: "当前页面仅支持桌面端Chromium内核浏览器(Chrome或Edge),请切换浏览器访问.",
    }
};

let currentLang: 'auto' | 'en' | 'zh' = 'auto';

function detectBrowserLanguage(): 'zh' | 'en' {
    const browserLang = navigator.language || (navigator as any).userLanguage;
    return browserLang.startsWith('zh') ? 'zh' : 'en';
}

function applyInitialLanguage() {
    currentLang = localStorage.getItem(LANGUAGE_KEY) as 'auto' | 'en' | 'zh' || DEFAULT_LANGUAGE;

    const langSelect = document.getElementById('languageSelect') as HTMLSelectElement | null;
    if (langSelect) {
        langSelect.value = 'auto';
    }
    updateTexts();
}

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

function initLanguageSwitcher() {
    const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement | null;
    if (!languageSelect) return;

    languageSelect.addEventListener('change', function () {
        currentLang = this.value as 'auto' | 'en' | 'zh';
        localStorage.setItem(LANGUAGE_KEY, currentLang);
        updateTexts();
    });

    languageSelect.value = currentLang;
}


export function initApp() {
    applyInitialLanguage();
    initLanguageSwitcher();
    const fileSelect = document.getElementById('fileSelect') as HTMLSelectElement;
    if (fileSelect && shareData?.drawerNames?.length > 0) {
        fileSelect.innerHTML = '';
        shareData.drawerNames.forEach((name, index) => {
            const option = document.createElement('option');
            option.value = index.toString();
            option.textContent = name;
            fileSelect.appendChild(option);
        });
        fileSelect.value = '0';
        shareData.drawIndex = 0;
          console.log('下拉框初始化完成，当前选项:', fileSelect.options);
        // 默认渲染第一个文件
        if (shareData.tgfxBaseView) {
            draw(shareData);
        }
    }
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
        input.addEventListener('change', function () {
            let value = parseInt(this.value);
            if (isNaN(value)) value = min;
            this.value = Math.max(min, Math.min(max, value)).toString();
        });
    };

    const inputs = [
        {id: 'maxTileCount', min: 1, max: 100},
        {id: 'maxUpdatePerFrame', min: 1, max: 100},
        {id: 'zoomInput', min: 1, max: 2000}
    ];

    inputs.forEach(({id, min, max}) => {
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


let canDraw = true;

function isPromise(obj: any): obj is Promise<any> {
    return !!obj && typeof obj.then === "function";
}

let lastDrawState = {
    index: -1,
    zoom: 0,
    offsetX: 0,
    offsetY: 0
};

function draw(shareData: ShareData) {
    const currentState = {
        index: shareData.drawIndex,
        zoom: shareData.zoom,
        offsetX: shareData.offsetX,
        offsetY: shareData.offsetY
    };

    // 检查状态是否变化
    const stateChanged = 
        currentState.index !== lastDrawState.index ||
        Math.abs(currentState.zoom - lastDrawState.zoom) > 0.001 ||
        Math.abs(currentState.offsetX - lastDrawState.offsetX) > 0.001 ||
        Math.abs(currentState.offsetY - lastDrawState.offsetY) > 0.001;

    if (canDraw && stateChanged) {
        console.log('开始绘制', {
            drawIndex: currentState.index,
            zoom: currentState.zoom,
            offsetX: currentState.offsetX,
            offsetY: currentState.offsetY,
            drawerName: shareData.drawerNames[currentState.index]
        });

        canDraw = false;
        lastDrawState = {...currentState};

    let result;
    try {
        result = shareData.tgfxBaseView.draw(
            currentState.index,
            currentState.zoom,
            currentState.offsetX,
            currentState.offsetY
        );
    } catch (e) {
        console.error('WASM绘制调用失败:', e);
        canDraw = true;
        return;
    }

        if (isPromise(result)) {
            result.then((res: boolean) => {
                canDraw = res;
                console.log('异步绘制完成', {result: res});
            });
        } else {
            canDraw = result;
            console.log('同步绘制完成', {result});
        }
    } else if (!stateChanged) {
        console.log('绘制状态未变化，跳过重绘');
    }
}

export function updateSize(shareData: ShareData) {
    if (!shareData.tgfxBaseView || !canDraw) {
        shareData.resized = false;
        return;
    }
    if (!canDraw) {
        if (shareData.updateSizeTimer) {
            clearTimeout(shareData.updateSizeTimer);
        }
        shareData.updateSizeTimer = window.setTimeout(() => {
            updateSize(shareData);
        }, 300);
        return;
    }
    shareData.resized = false;
    console.log("updateSize");
    const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
    const container = document.getElementById('container') as HTMLDivElement;
    const screenRect = container.getBoundingClientRect();
    const scaleFactor = window.devicePixelRatio;
    canvas.width = screenRect.width * scaleFactor;
    canvas.height = screenRect.height * scaleFactor;
    canvas.style.width = screenRect.width + "px";
    canvas.style.height = screenRect.height + "px";
    shareData.tgfxBaseView.updateSize(scaleFactor);
}

let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 1000 / 30; // 30fps

export function animationLoop(shareData: ShareData) {
    const frame = async (timestamp: number) => {
        if (!shareData.tgfxBaseView || !shareData.isPageVisible) {
            shareData.animationFrameId = null;
            return;
        }

        const now = performance.now();
        if (now - lastRenderTime >= MIN_RENDER_INTERVAL) {
            await draw(shareData);
            lastRenderTime = now;
        }
        
        shareData.animationFrameId = requestAnimationFrame(frame);
    };
    
    if (!shareData.animationFrameId) {
        shareData.animationFrameId = requestAnimationFrame(frame);
    }
}

export function onResizeEvent(shareData: ShareData) {
    if (!shareData.tgfxBaseView || shareData?.resized) {
        return;
    }
    shareData.resized = true;
    if (shareData.updateSizeTimer) {
        clearTimeout(shareData.updateSizeTimer);
    }
    shareData.updateSizeTimer = window.setTimeout(() => {
        updateSize(shareData);
    }, 300);
}

function handleVisibilityChange(shareData: ShareData) {
    shareData.isPageVisible = !document.hidden;
    if (shareData.isPageVisible && shareData.animationFrameId === null) {
        animationLoop(shareData);
    }
}

export function setupVisibilityListeners(shareData: ShareData) {
    if (typeof window !== 'undefined') {
        document.addEventListener('visibilitychange', () => handleVisibilityChange(shareData));
        window.addEventListener('beforeunload', () => {
            if (shareData.animationFrameId !== null) {
                cancelAnimationFrame(shareData.animationFrameId);
                shareData.animationFrameId = null;
            }
        });
    }
}


export function checkBrowser(): boolean {
    const browserWarning = document.getElementById('browser-warning') as HTMLElement;
    const maskOverlay = document.getElementById('mask-overlay') as HTMLElement;

    function isMobile(): boolean {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    function isChromiumBased(): boolean {
        const ua = navigator.userAgent;
        return ua.includes('Chrome') || ua.includes('Edge');
    }

    function isDesktop(): boolean {
        return !isMobile();
    }

    let isSupported = true;
    if (!isDesktop() || !isChromiumBased()) {
        if (browserWarning && maskOverlay) {
            browserWarning.classList.remove('hidden');
            maskOverlay.classList.remove('hidden');
            setTimeout(() => {
                browserWarning.classList.add('show');
            }, 100);
        }
        isSupported = false;
    }
    localStorage.setItem('isSupported', JSON.stringify(isSupported));
    return isSupported;
}


export async function loadModule(engineDir: string = "displaylist", type: string = "mt") {
    if (!shareData) {
        shareData = new ShareData();
    }
    const Displaylist = await import(`${engineDir}.js`);
    if (type === 'mt') {
        if (!crossOriginIsolated) {
            throw new Error('The current environment does not support multi-threaded WebAssembly, please check the COOP and COEP settings');
        }

        if (typeof SharedArrayBuffer === 'undefined') {
            throw new Error('SharedArrayBuffer is not supported in this environment');
        }
    }

    const moduleConfig = {
        locateFile: (file: string) => {
            return `${engineDir}.wasm`;
        }
    };
    if (type === 'mt') {
        moduleConfig['mainScriptUrlOrBlob'] = `${engineDir}.js`;
    }

    try {
        shareData.DisplaylistModule = await Displaylist.default(moduleConfig);
        TGFXBind(shareData.DisplaylistModule);
        
        if (!shareData.DisplaylistModule.TGFXThreadsView) {
            throw new Error('WASM模块未正确初始化，缺少TGFXThreadsView');
        }
        
        const tgfxView = shareData.DisplaylistModule.TGFXThreadsView.MakeFrom('#displaylist');
        if (!tgfxView) {
            throw new Error('无法创建TGFX视图');
        }
        shareData.tgfxBaseView = tgfxView;
    } catch (e) {
        console.error('WASM初始化失败:', e);
        throw e;
    }
    const drawerNames = await shareData.tgfxBaseView.getDrawerNames();
    shareData.drawerNames = [];
    
    // 检查是否是C++对象
    if (drawerNames && typeof drawerNames.size === 'function') {
        for (let i = 0; i < drawerNames.size(); i++) {
            shareData.drawerNames.push(drawerNames.get(i));
        }
    } else if (Array.isArray(drawerNames)) {
        // 如果已经是数组直接使用
        shareData.drawerNames = drawerNames;
    }
    
    console.log('读取到的Drawer名称列表:', shareData.drawerNames);
//
    try {
        // 使用绝对路径加载图片
        const baseUrl = window.location.origin;
        const imagePath1 = `${baseUrl}/static/resources/assets/bridge.jpg`;
        await shareData.tgfxBaseView.setImagePath("bridge", imagePath1);
        
        const imagePath2 = `${baseUrl}/static/resources/assets/tgfx.png`;
        await shareData.tgfxBaseView.setImagePath("TGFX", imagePath2);
        
        const fontPath = "/static/resources/font/NotoSansSC-Regular.otf";
        const fontBuffer = await fetch(fontPath).then((response) => response.arrayBuffer());
        const fontUIntArray = new Uint8Array(fontBuffer);
        
        const emojiFontPath = "/static/resources/font/NotoColorEmoji.ttf";
        const emojiFontBuffer = await fetch(emojiFontPath).then((response) => response.arrayBuffer());
        const emojiFontUIntArray = new Uint8Array(emojiFontBuffer);
        
        shareData.tgfxBaseView.registerFonts(fontUIntArray, emojiFontUIntArray);
    } catch (e) {
        console.error('！！！资源加载失败:', e);
        throw e;
    }
    updateSize(shareData);
    animationLoop(shareData);
    setupVisibilityListeners(shareData);
}

export function bindEventListeners() {
    const showDirtyRect = document.getElementById('showDirtyRect') as HTMLSelectElement | null;
    if (showDirtyRect && shareData.tgfxBaseView) {
        showDirtyRect.addEventListener('change', () => {
            shareData.tgfxBaseView.setShowDirtyRect(showDirtyRect.value === 'true');
        });
    }
    const fileSelect = document.getElementById('fileSelect') as HTMLSelectElement | null;
    if (fileSelect && shareData.tgfxBaseView) {
        fileSelect.addEventListener('change', () => {
            const selectedIndex = parseInt(fileSelect.value);
            if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < shareData.drawerNames.length) {
                // 记录切换前的状态
                const prevIndex = shareData.drawIndex;
                const prevName = shareData.drawerNames[prevIndex];
                const newName = shareData.drawerNames[selectedIndex];
                
                console.log(`绘图项切换: 从 ${prevName} (索引:${prevIndex}) 到 ${newName} (索引:${selectedIndex})`);
                
                // 只有实际发生变化时才更新
                if (selectedIndex !== prevIndex) {
                    shareData.drawIndex = selectedIndex;
                    // 重置视图状态
                    shareData.zoom = 1.0;
                    shareData.offsetX = 0;
                    shareData.offsetY = 0;
                    
                    // 触发重新渲染
                    draw(shareData);
                } else {
                    console.log('绘图项未变化，跳过重绘');
                }
            }
        });
    }
}
