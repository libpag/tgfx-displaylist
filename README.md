English | [简体中文](./README.zh_CN.md)

## Introduction
***

This project showcases the rendering capabilities of the [tgfx-layers](https://github.com/Tencent/tgfx/tree/main/include/tgfx/layers) module, 
including advanced caching mechanisms such as partial refresh and tile-based rendering. It supports building complex, 
large-scale layer rendering trees that allow users to interact through actions like dragging, zooming, selecting, and rotating. 
This project provides an intuitive way to showcase the specific usage and performance of the [tgfx-layers](https://github.com/Tencent/tgfx/tree/main/include/tgfx/layers) module.

You can also visit [tgfx-displaylist](https://tgfx.org/displaylist) online to experience the rendering capabilities of [tgfx-layers](https://github.com/Tencent/tgfx/tree/main/include/tgfx/layers) in real-time.

## Getting Started
***

Before building the projects, please carefully follow the instructions in the
[**Build Prerequisites**](https://github.com/Tencent/tgfx?tab=readme-ov-file#build-prerequisites)
and [**Dependencies**](https://github.com/Tencent/tgfx?tab=readme-ov-file#dependencies) sections.
These will guide you through the necessary steps to set up your development environment.

### Web

To get started, go to the `web/` directory and run the following command to install the necessary
node modules:

```
npm install
```

Then, in the `web/` directory, run the following command to build the demo project:

```
npm run build
```

This will generate the `displaylist.js` and `displaylist.wasm` files in the `web/demo/wasm-mt` directory.
Next, you can start an HTTP server by running the following command:

```
npm run server
```

This will open [http://localhost:8061/web/demo/index.html](http://localhost:8061/web/demo/index.html)
in your default browser. You can also open it manually to view the demo.

To debug the C++ code, install the browser plugin:
[**C/C++ DevTools Support (DWARF)**](https://chromewebstore.google.com/detail/cc++-devtools-support-dwa/pdcpmagijalfljmkmjngeonclgbbannb).
Then, open Chrome DevTools, go to Settings > Experiments, and enable the option
**WebAssembly Debugging: Enable DWARF support**.

Next, replace the previous build command with:

```
npm run build:debug
```

With these steps completed, you can debug C++ files directly in Chrome DevTools.

To build the demo project in CLion, open the `Settings` panel and go to `Build, Execution, Deployment` > `CMake`.
Create a new build target and set the `CMake options` to:

```
DCMAKE_TOOLCHAIN_FILE="path/to/emscripten/emscripten/version/cmake/Modules/Platform/Emscripten.cmake"
```

After creating the build target, adjust the `Configurations` to match the new build target. This will
allow you to build the tgfx library in CLion.

Additionally, when using `ESModule` for your project, you need to manually include the generated
`.wasm` file in the final web program. Common packing tools often ignore the `.wasm` file. Also,
make sure to upload the `.wasm` file to a server so users can access it.