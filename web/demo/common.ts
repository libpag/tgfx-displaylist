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
import {gestureManager, initMouseEvents} from './mouseEvent';

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

// 如果需要CDN部署，可以通过全局变量覆盖这些值
if (typeof window !== 'undefined' && (window as any).STATIC_CONFIG) {
    const config = (window as any).STATIC_CONFIG;
    if (config.STATIC_RESOURCE_BASE) STATIC_RESOURCE_BASE = config.STATIC_RESOURCE_BASE;
    if (config.ASSETS_BASE) ASSETS_BASE = config.ASSETS_BASE;
    if (config.FONT_BASE) FONT_BASE = config.FONT_BASE;
}

export class TGFXBaseView {
    public updateSize: (devicePixelRatio: number) => void;
    public draw: (drawIndex: number, zoom: number, offsetX: number, offsetY: number) => boolean;
    public setAllowBlur: (allowBlur: boolean) => void;
    public setShowDirtyRect: (isVisible: boolean) => void;
    public getDrawerNames: () => Promise<any>;
    public setImage: (name: string, image: HTMLImageElement) => void;
    public setTileSize: (size: number) => void;
    public setMaxTileCount: (count: number) => void;
    public registerFonts: (fontVal: Uint8Array, emojiFontVal: Uint8Array) => void;
    public setRenderMode: (mode: number) => void;
    public highlightLayerAndCheckRedraw: (x: number, y: number) => boolean;
    public resetHighlightLayer: () => boolean;
    public selectMoveLayer: (pointX: number, pointY: number) => boolean;
    public moveHighlightLayer: (deltaX: number, deltaY: number) => boolean;
    public markDirty: () => void;
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
                const viewportCenterX = rect.left + rect.width / 2;
                const viewportCenterY = rect.top + rect.height / 2;
                const canvasCenterX = (viewportCenterX - rect.left) * window.devicePixelRatio;
                const canvasCenterY = (viewportCenterY - rect.top) * window.devicePixelRatio;
                const newZoom = val / 100;
                shareData.offsetX = (shareData.offsetX - canvasCenterX) * (newZoom / shareData.zoom) + canvasCenterX;
                shareData.offsetY = (shareData.offsetY - canvasCenterY) * (newZoom / shareData.zoom) + canvasCenterY;
                shareData.zoom = newZoom;
            } else {
                shareData.zoom = val / 100;
            }
            shareData.tgfxBaseView?.markDirty();
            animationLoop(shareData);
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

// 简化的绘制函数，基于 AppHost 脏标记系统
export function draw(shareData: ShareData): boolean {
    if (!shareData.isPageVisible || !shareData.tgfxBaseView) {
        return false;
    }

    try {
        // 直接调用 draw 方法，让 AppHost 内部处理脏标记逻辑
        return shareData.tgfxBaseView.draw(
            shareData.drawIndex,
            shareData.zoom,
            shareData.offsetX,
            shareData.offsetY
        );
    } catch (e) {
        console.error('Drawing error:', e);
        return false;
    }
}

export function updateSize(shareData: ShareData) {
    if (!shareData.tgfxBaseView) {
        shareData.resized = false;
        return;
    }

    shareData.resized = false;
    const canvas = document.getElementById('displaylist') as HTMLCanvasElement;
    const container = document.getElementById('container') as HTMLDivElement;

    const style = window.getComputedStyle(container);
    const MIN_CONTAINER_WIDTH = 50;
    const MIN_CONTAINER_HEIGHT = 50;

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
    const newWidth = Math.max(1, Math.floor(width * scaleFactor));
    const newHeight = Math.max(1, Math.floor(height * scaleFactor));

    const widthChanged = Math.abs(canvas.width - newWidth) > canvas.width * 0.001;
    const heightChanged = Math.abs(canvas.height - newHeight) > canvas.height * 0.001;

    if (widthChanged || heightChanged) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";

        shareData.tgfxBaseView.updateSize(scaleFactor);
        shareData.tgfxBaseView.markDirty();
        animationLoop(shareData);
    }
}

let animationLoopRunning = false;

// 简化的动画循环，基于 AppHost 脏标记系统
export function animationLoop(shareData: ShareData) {
    if (animationLoopRunning) {
        return;
    }
    animationLoopRunning = true;

    const frame = () => {
        if (!shareData.tgfxBaseView || !shareData.isPageVisible) {
            animationLoopRunning = false;
            shareData.animationFrameId = null;
            return;
        }

        // 调用绘制函数，如果返回 true 表示有内容被绘制，继续循环
        const hasDrawn = draw(shareData);
        
        if (hasDrawn) {
            shareData.animationFrameId = requestAnimationFrame(frame);
        } else {
            animationLoopRunning = false;
            shareData.animationFrameId = null;
        }
    };
    shareData.animationFrameId = requestAnimationFrame(frame);
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
        shareData.tgfxBaseView.setImage("bridge", image1);

        const image2 = await loadImage(`${ASSETS_BASE}/tgfx.png`);
        shareData.tgfxBaseView.setImage("TGFX", image2);

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
    if (!shareData.tgfxBaseView) {
        console.warn('TGFXBaseView not initialized, skipping event binding');
        return;
    }

    // 文件选择切换
    const fileSelect = document.getElementById('fileSelect') as HTMLSelectElement | null;
    if (fileSelect) {
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

                    // 重置脏矩形显示状态
                    const showDirtyRect = document.getElementById('showDirtyRect') as HTMLSelectElement | null;
                    if (showDirtyRect) {
                        shareData.tgfxBaseView.setShowDirtyRect(false);
                        showDirtyRect.value = 'false';
                    }

                    shareData.tgfxBaseView.markDirty();
                    animationLoop(shareData);
                }
            }
        });
    }

    // 渲染模式切换
    const renderModeSelect = document.getElementById('renderModeSelect') as HTMLSelectElement | null;
    if (renderModeSelect) {
        renderModeSelect.addEventListener('change', () => {
            const mode = renderModeSelect.value;
            let modeValue = 0; // 0=Direct, 1=Partial, 2=Tiled
            if (mode === 'partial') modeValue = 1;
            else if (mode === 'tile') modeValue = 2;

            shareData.tgfxBaseView.setRenderMode(modeValue);

            // 如果是瓦片模式，显示额外选项
            const tileOptions = document.getElementById('tileOptions');
            if (tileOptions) {
                tileOptions.classList.toggle('hidden', mode !== 'tile');
            }

            shareData.tgfxBaseView.markDirty();
            animationLoop(shareData);
        });
    }

    // 瓦片大小设置
    const tileSizeSelect = document.getElementById('tileSizeSelect') as HTMLSelectElement | null;
    if (tileSizeSelect) {
        tileSizeSelect.addEventListener('change', () => {
            const tileSize = parseInt(tileSizeSelect.value);
            console.log(`Setting tile size to: ${tileSize} for drawer index: ${shareData.drawIndex}`);
            shareData.tgfxBaseView.setTileSize(tileSize);
            shareData.tgfxBaseView.markDirty();
            animationLoop(shareData);
        });
    }

    // 最大瓦片数设置
    const maxTileCount = document.getElementById('maxTileCount') as HTMLInputElement | null;
    if (maxTileCount) {
        maxTileCount.addEventListener('change', () => {
            const count = parseInt(maxTileCount.value);
            console.log(`Setting max tile count to: ${count} for drawer index: ${shareData.drawIndex}`);
            shareData.tgfxBaseView.setMaxTileCount(count);
            shareData.tgfxBaseView.markDirty();
            animationLoop(shareData);
        });
    }

    // 允许模糊设置
    const allowBlur = document.getElementById('allowBlur') as HTMLSelectElement | null;
    if (allowBlur) {
        allowBlur.addEventListener('change', () => {
            const allow = allowBlur.value === 'true';
            shareData.tgfxBaseView.setAllowBlur(allow);
            shareData.tgfxBaseView.markDirty();
            animationLoop(shareData);
        });
    }

    // 脏矩形显示切换
    const showDirtyRect = document.getElementById('showDirtyRect') as HTMLSelectElement | null;
    if (showDirtyRect) {
        // 初始设置为false
        shareData.tgfxBaseView.setShowDirtyRect(false);
        showDirtyRect.value = 'false'; // 确保UI状态同步

        showDirtyRect.addEventListener('change', () => {
            const show = showDirtyRect.value === 'true';
            shareData.tgfxBaseView.setShowDirtyRect(show);
            shareData.tgfxBaseView.markDirty();
            animationLoop(shareData);
        });
    }
}