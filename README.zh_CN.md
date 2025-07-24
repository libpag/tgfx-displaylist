[English](./README.md) | 简体中文

## 介绍
***

该项目展示了 [tgfx-layers](https://github.com/Tencent/tgfx/tree/main/include/tgfx/layers) 模块的渲染能力，包括先进的缓存机制，如脏矩形刷新和瓦片渲染。
它支持构建复杂的大型图层渲染树，供用户进行拖拽、缩放、点选、旋转等交互操作。该项目能够直观地展示 [tgfx-layers](https://github.com/Tencent/tgfx/tree/main/include/tgfx/layers) 模块的具体用法及性能水平。

您还可以在线运行 [tgfx-displaylist](https://tgfx.org/displaylist) ，真实体验 [tgfx-layers](https://github.com/Tencent/tgfx/tree/main/include/tgfx/layers) 的渲染能力。

## 快速接入
***

在构建项目之前，请仔细阅读并遵循以下内容中的说明：[**构建前提条件**](https://github.com/Tencent/tgfx?tab=readme-ov-file#build-prerequisites) 和 [**依赖项**](https://github.com/Tencent/tgfx?tab=readme-ov-file#dependencies) 部分。这些将引导您完成设置开发环境所需的步骤。

### Web 端接入

首先，转到web/目录并执行如下命令来安装必要的依赖项

```
npm install
```

然后，在web/目录运行以下命令来构建项目

```
npm run build
```

这将会在 web/demo/wasm-mt 目录中生成 displaylist.js 和 displaylist.wasm 文件。
接下来，您可以通过运行以下命令启动一个 HTTP 服务器：

```
npm run server
```

这将会在您的默认浏览器中打开 http://localhost:8061/web/demo/index.html 您也可以手动打开该链接来查看示例。

要调试 C++ 代码，请安装浏览器插件：C/C++ DevTools Support (DWARF)。
然后，打开 Chrome 开发者工具，进入设置 > Experiments 面板，启用 WebAssembly Debugging: Enable DWARF support 选项。

接下来，使用以下命令替代之前的构建命令

```
npm run build:debug
```

完成这些步骤后，您可以直接在 Chrome 开发者工具中调试 C++ 文件。

在 CLion 中构建示例项目，打开 Settings 面板，进入 Build, Execution, Deployment > CMake。
创建一个新的构建目标，并将 CMake options 设置为

```
DCMAKE_TOOLCHAIN_FILE="path/to/emscripten/emscripten/version/cmake/Modules/Platform/Emscripten.cmake"
```

创建构建目标后，调整 Configurations 以匹配新的构建目标。这将允许您在 CLion 中构建 tgfx 库。

另外，当您的项目使用 ESModule 时，您需要手动将生成的 .wasm 文件包含到最终的 Web 程序中。常见的打包工具通常会忽略 .wasm 文件。此外，确保将 .wasm 文件上传到服务器，以便用户可以访问它。