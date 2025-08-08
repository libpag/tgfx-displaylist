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

import {
    initApp,
    loadModule,
    onResizeEvent,
    checkBrowser,
    bindEventListeners,
    shareData,
} from "./common"

if (typeof window !== 'undefined') {
    window.onload = async () => {
        try {
            initApp();
            if(checkBrowser()){
                await loadModule('/wasm-mt/displaylist');
                bindEventListeners();
            }else {
                throw new Error("This website only supports desktop browsers based on Chromium (like Chrome or Edge). Please switch to one of these browsers to access it.");
            }

        } catch (error) {
            console.error(error);
            throw new Error("displaylist init failed. Please check the .wasm file path!.");
        }
    };

    window.onresize = () => {
        const isSupported = JSON.parse(localStorage.getItem('isSupported'));
        if(isSupported){
            onResizeEvent(shareData);
        }
    };

    window.onclick = () => {
        // onClickEvent(shareData);
    };
}
