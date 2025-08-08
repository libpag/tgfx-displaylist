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
#include <emscripten/bind.h>
#include "TGFXThreadsView.h"

using namespace displaylist;
using namespace emscripten;

EMSCRIPTEN_BINDINGS(TGFXDemo) {

  class_<TGFXBaseView>("TGFXBaseView")
      .function("setImagePath", &TGFXBaseView::setImagePath)
      .function("updateSize", &TGFXBaseView::updateSize)
      .function("draw", &TGFXBaseView::draw)
      .function("setAllowBlur", &TGFXBaseView::setAllowBlur)
      .function("setShowDirtyRect", &TGFXBaseView::setShowDirtyRect);

  class_<TGFXThreadsView, base<TGFXBaseView>>("TGFXThreadsView")
      .smart_ptr<std::shared_ptr<TGFXThreadsView>>("TGFXThreadsView")
      .class_function("MakeFrom", optional_override([](const std::string& canvasID) {
                        if (canvasID.empty()) {
                          return std::shared_ptr<TGFXThreadsView>(nullptr);
                        }
                        return std::make_shared<TGFXThreadsView>(canvasID);
                      }))
      .function("registerFonts", &TGFXThreadsView::registerFonts);
}