import resolve from '@rollup/plugin-node-resolve';
import commonJs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import {terser} from 'rollup-plugin-terser';
import esbuild from 'rollup-plugin-esbuild';
import path from "path";
import {readFileSync} from "node:fs";

const fileHeaderPath = path.resolve(__dirname, '../../.idea/fileTemplates/includes/tgfx-displaylist File Header.h');
const banner = readFileSync(fileHeaderPath, 'utf-8');


const plugins=[
    esbuild({
        tsconfig: 'tsconfig.json',
        minify: false
    }),
    json(),
    resolve(),
    commonJs()
];

const umdConfig = {
    input: '../third_party/tgfx/web/src/binding.ts',
    output: [
        {
            name: 'tgfx',
            banner,
            format: 'umd',
            exports: 'named',
            sourcemap: true,
            file: 'lib/tgfx.js',
        },
    ],
    plugins: plugins,
};

const umdMinConfig = {
    input: '../third_party/tgfx/web/src/binding.ts',
    output: [
        {
            name: 'tgfx',
            banner,
            format: 'umd',
            exports: 'named',
            sourcemap: true,
            file: 'lib/tgfx.min.js',
        },
    ],
    plugins: [
        ...plugins,
        terser(),
    ],
};

export default [
    umdConfig,
    umdMinConfig,
    {
        input: '../third_party/tgfx/web/src/binding.ts',
        output: [
            {banner, file: 'lib/tgfx.esm.js', format: 'esm', sourcemap: true},
            {banner, file: 'lib/tgfx.cjs.js', format: 'cjs', exports: 'auto', sourcemap: true},
        ],
        plugins: plugins,
    },
];
