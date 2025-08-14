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
import { gestureManager, initMouseEvents } from './mouseEvent';

export function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
// 静态资源配置
let STATIC_RESOURCE_BASE = '/static/resources';
let ASSETS_BASE = '/static/resources/assets';
let FONT_BASE = '/static/resources/font';

// 如果需要CDN部署，可以通过全局变量覆盖这些值/不确定对不对
if (typeof window !== 'undefined' && (window as any).STATIC_CONFIG) {
    const config = (window as any).STATIC_CONFIG;
    if (config.STATIC_RESOURCE_BASE) STATIC_RESOURCE_BASE = config.STATIC_RESOURCE_BASE;
    if (config.ASSETS_BASE) ASSETS_BASE = config.ASSETS_BASE;
    if (config.FONT_BASE) FONT_BASE = config.FONT_BASE;
}

export class TGFXBaseView {
    public updateSize: (devicePixelRatio: number) => void;
    public draw: (drawIndex: number, zoom: number, offsetX: number, offsetY: number) => boolean;
    public setAllowBlur: (allowBlur: boolean,drawIndex:number) => void;
    public setShowDirtyRect: (isVisible: boolean) => void;
    public getDrawerNames: () => Promise<any>;
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
    public forceRedraw: boolean = false; // 新增强制重绘标志
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
    //const lang = translations[langToUse] || translations[DEFAULT_LANGUAGE];

    document.querySelectorAll<HTMLElement>('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        //防御 lang 不存在或没定义
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
    const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
    canvas.addEventListener('webglcontextlost', (e) => {
        console.error('WebGL context lost');
        e.preventDefault();
    });
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
        val = Math.max(10, Math.min(20000, Math.round(val * 10))) / 10;
        currentZoom = val;
        if (zoomValue) zoomValue.textContent = `${val}%`;
        if (zoomInput) zoomInput.value = val.toString();
        if (shareData) {
            const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                // 计算画布在视口中的中心点（考虑所有布局偏移）
                const viewportCenterX = rect.left + rect.width / 2;
                const viewportCenterY = rect.top + rect.height / 2;
                
                // 转换为画布坐标系中的点（考虑devicePixelRatio）
                const canvasCenterX = (viewportCenterX - rect.left) * window.devicePixelRatio;
                const canvasCenterY = (viewportCenterY - rect.top) * window.devicePixelRatio;
                
                // 计算新的zoom比例
                const newZoom = val / 100;
                
                // 以画布中心点为基准调整offset
                shareData.offsetX = (shareData.offsetX - canvasCenterX) * (newZoom / shareData.zoom) + canvasCenterX;
                shareData.offsetY = (shareData.offsetY - canvasCenterY) * (newZoom / shareData.zoom) + canvasCenterY;
                shareData.zoom = newZoom;
            } else {
                shareData.zoom = val / 100;
            }
            lastDrawState = {
                index: -1,
                zoom: -1,
                offsetX: -1,
                offsetY: -1
            };
            canDraw = true;
            draw(shareData);
        }
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
        zoomDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = zoomDisplay.getAttribute('aria-expanded') === 'true';
            zoomDisplay.setAttribute('aria-expanded', (!isExpanded).toString());
            zoomDropdown.classList.toggle('show', !isExpanded);
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


async function draw(shareData: ShareData): Promise<void> {
    if (!canDraw || !shareData.isPageVisible) return;
    
    // 检查是否需要强制重绘
    if (shareData.forceRedraw) {
        shareData.forceRedraw = false;
        lastDrawState = {
            index: -1,
            zoom: -1,
            offsetX: -1,
            offsetY: -1
        };
    }
    
    const currentState = {
        index: shareData.drawIndex,
        zoom: shareData.zoom,
        offsetX: shareData.offsetX,
        offsetY: shareData.offsetY
    };
    
    if (JSON.stringify(currentState) === JSON.stringify(lastDrawState)) {
        return;
    }

    const drawState = {
        index: shareData.drawIndex,
        zoom: shareData.zoom,
        offsetX: shareData.offsetX,
        offsetY: shareData.offsetY
    };
    //复用代码优化



    canDraw = false;
    lastDrawState = {...drawState};

    const retryDraw = async () => {
        let result = false;
        let retryCount = 0;
        
        while (!result && retryCount < 3) {
            try {
                result = shareData.tgfxBaseView.draw(
                    drawState.index,
                    drawState.zoom,
                    drawState.offsetX,
                    drawState.offsetY
                );
                
                if (!result) {
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (e) {
                console.error('Drawing error:', e);
                break;
            }
        }
        return result;
    };
    
    try {
        const result = await retryDraw();
        canDraw = result;
        return;
    } catch (e) {
        console.error('WASM drawing failed:', e);
        canDraw = true;
        return;
    }
}

export function updateSize(shareData: ShareData) {
    if (!shareData.tgfxBaseView) {
        shareData.resized = false;
        return;
    }

    lastDrawState = {
        index: -1,
        zoom: -1,
        offsetX: -1,
        offsetY: -1
    };
    canDraw = true;

    shareData.resized = false;
    //防御下述两个为空
    const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
    const container = document.getElementById('container') as HTMLDivElement;
    
    const style = window.getComputedStyle(container);
    // 最小尺寸保护，防止容器过小导致渲染异常
    const MIN_CONTAINER_WIDTH = 50;
    const MIN_CONTAINER_HEIGHT = 50;
    
    // 计算容器有效尺寸，确保不小于最小值
    const width = Math.max(MIN_CONTAINER_WIDTH, 
                         container.clientWidth 
                        - parseFloat(style.paddingLeft)
                        - parseFloat(style.paddingRight)
                        - parseFloat(style.borderLeftWidth)
                        - parseFloat(style.borderRightWidth));
    
    const height = Math.max(MIN_CONTAINER_HEIGHT,
                          container.clientHeight
                         - parseFloat(style.paddingTop)
                         - parseFloat(style.paddingBottom)
                         - parseFloat(style.borderTopWidth)
                         - parseFloat(style.borderBottomWidth));
    
    const scaleFactor = Math.max(1, Math.floor(window.devicePixelRatio * 100) / 100);
    // 确保最终渲染尺寸不小于1像素
    const newWidth = Math.max(1, Math.floor(width * scaleFactor));
    const newHeight = Math.max(1, Math.floor(height * scaleFactor));
    //解决magic number问题
    
    const widthChanged = Math.abs(canvas.width - newWidth) > canvas.width * 0.001;
    const heightChanged = Math.abs(canvas.height - newHeight) > canvas.height * 0.001;
    
    if (widthChanged || heightChanged) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        
        shareData.tgfxBaseView.updateSize(scaleFactor);
        requestAnimationFrame(() => draw(shareData));
    }
}

let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 1000 / 30;

export function animationLoop(shareData: ShareData) {
    const frame = async (timestamp: number) => {
        if (!shareData.tgfxBaseView || !shareData.isPageVisible) {
            shareData.animationFrameId = null;
            return;
        }

        const now = performance.now();
        if (now - lastRenderTime >= MIN_RENDER_INTERVAL || !shareData.isPageVisible) {
            if (!shareData.isPageVisible) {
                lastDrawState = {
                    index: -1,
                    zoom: -1,
                    offsetX: -1,
                    offsetY: -1
                };
                canDraw = true;
            }
            await draw(shareData).catch(e => console.error('Drawing failed:', e));
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
    updateSize(shareData);
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
            throw new Error('WASM module not initialized correctly, missing TGFXThreadsView');
        }
        
        const tgfxView = shareData.DisplaylistModule.TGFXThreadsView.MakeFrom('#displaylist');
        if (!tgfxView) {
            throw new Error('Failed to create TGFX view');
        }
        shareData.tgfxBaseView = tgfxView;
    } catch (e) {
        console.error('WASM initialization failed:', e);
        throw e;
    }
    const drawerNames = await shareData.tgfxBaseView.getDrawerNames();
    shareData.drawerNames = [];
    
    if (drawerNames && typeof drawerNames.size === 'function') {
        for (let i = 0; i < drawerNames.size(); i++) {
            shareData.drawerNames.push(drawerNames.get(i));
        }
    } else if (Array.isArray(drawerNames)) {
        shareData.drawerNames = drawerNames;
    }
    
    console.log('Drawer names loaded:', shareData.drawerNames);

    try {
        // 使用配置的静态资源路径
        const image1 = await loadImage(`${ASSETS_BASE}/bridge.jpg`);
        shareData.tgfxBaseView.setImageRef("bridge", image1);
        
        const image2 = await loadImage(`${ASSETS_BASE}/tgfx.png`);
        shareData.tgfxBaseView.setImageRef("TGFX", image2);
        
        const fontPath = `${FONT_BASE}/NotoSansSC-Regular.otf`;
        const fontBuffer = await fetch(fontPath).then((response) => response.arrayBuffer());
        const fontUIntArray = new Uint8Array(fontBuffer);
        
        const emojiFontPath = `${FONT_BASE}/NotoColorEmoji.ttf`;
        const emojiFontBuffer = await fetch(emojiFontPath).then((response) => response.arrayBuffer());
        const emojiFontUIntArray = new Uint8Array(emojiFontBuffer);
        
        shareData.tgfxBaseView.registerFonts(fontUIntArray, emojiFontUIntArray);
    } catch (e) {
        console.error('Resource loading failed:', e);
        throw e;
    }

    shareData.drawIndex = 0;
    shareData.zoom = 1.0;
    shareData.offsetX = 0;
    shareData.offsetY = 0;
    canDraw = true;
    lastDrawState = {
        index: -1,
        zoom: -1,
        offsetX: -1,
        offsetY: -1
    };
    
    // 初始化鼠标事件
    const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
    initMouseEvents(canvas, shareData);
    
    // 绑定zoom变化事件
    gestureManager.onZoomChange((zoom) => {
        const zoomValue = document.getElementById('zoomValue');
        if (zoomValue) {
            zoomValue.textContent = `${Math.round(zoom * 100)}%`;
        }
    });
    
    updateSize(shareData);
    animationLoop(shareData);
    setupVisibilityListeners(shareData);
}

export function bindEventListeners() {
    const showDirtyRect = document.getElementById('showDirtyRect') as HTMLSelectElement | null;
    if (showDirtyRect && shareData.tgfxBaseView) {
        // 初始设置为false
        shareData.tgfxBaseView.setShowDirtyRect(false, shareData.drawIndex);
        showDirtyRect.value = 'false'; // 确保UI状态同步
        
        // 切换测试用例时重置脏矩形显示状态
        const fileSelect = document.getElementById('fileSelect');
        if (fileSelect) {
            fileSelect.addEventListener('change', () => {
                shareData.tgfxBaseView.setShowDirtyRect(false, shareData.drawIndex);
                showDirtyRect.value = 'false';
            });
        }
        
        showDirtyRect.addEventListener('change', () => {
            const show = showDirtyRect.value === 'true';
            shareData.tgfxBaseView.setShowDirtyRect(show, shareData.drawIndex);
            
            shareData.forceRedraw = true; // 设置强制重绘标志
            draw(shareData); // 触发重绘
        });
    }
    const fileSelect = document.getElementById('fileSelect') as HTMLSelectElement | null;
    if (fileSelect && shareData.tgfxBaseView) {
        fileSelect.addEventListener('change', () => {
            const selectedIndex = parseInt(fileSelect.value);
            if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < shareData.drawerNames.length) {
                const prevIndex = shareData.drawIndex;
                const prevName = shareData.drawerNames[prevIndex];
                const newName = shareData.drawerNames[selectedIndex];
                
                console.log(`Switched drawer: from ${prevName} (index:${prevIndex}) to ${newName} (index:${selectedIndex})`);
                
                if (selectedIndex !== prevIndex) {
                    shareData.drawIndex = selectedIndex;
                    shareData.zoom = 1.0;
                    shareData.offsetX = 0;
                    shareData.offsetY = 0;
                    
                    // 更新zoom显示
                    const zoomValue = document.getElementById('zoomValue');
                    if (zoomValue) {
                        zoomValue.textContent = '100%';
                    }
                
                draw(shareData);
                }
            }
        });
    }
}