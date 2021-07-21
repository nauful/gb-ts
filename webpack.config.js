const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlMinimizerPlugin = require("html-minimizer-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = [{
    target: 'es6',
    mode: 'production',
    entry: './build/src/index.js',
    output: {
        path: path.join(__dirname, 'build'),
        filename: 'bundle.js',
        chunkFormat: 'commonjs'
    },
    module: {
        rules: [{
            test: /\.(woff|woff2)$/,
            use: { loader: 'url-loader', },
        }, {
            test: /\.less$/,
            use: [MiniCssExtractPlugin.loader, 'css-loader', 'less-loader']
        }]
    },
    resolve: {
        modules: [path.resolve(__dirname, 'node_modules'), path.resolve(__dirname, 'src')]
    },
    plugins: [
        new MiniCssExtractPlugin({ filename: 'bundle.css' })
    ],
    optimization: {
        minimizer: [
            new TerserPlugin({
                parallel: true,
                terserOptions: {
                    compress: { passes: 3 },
                    module: true,
                    mangle: {
                        properties: true,
                        toplevel: true
                    },
                    format: {
                        comments: false
                    },
                    ecma: 'es6'
                },
            }), new CssMinimizerPlugin()]
    },
}, {
    entry: './src/index.html',
    mode: 'production',
    module: {
        rules: [{ test: /\.html$/i, type: 'asset/resource', }],
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: './src/index.html', to: path.resolve(__dirname, 'build') }],
        }),
    ],
    optimization: {
        minimize: true,
        minimizer: [`...`, new HtmlMinimizerPlugin({
            minimizerOptions: {
                collapseWhitespace: true,
                collapseInlineTagWhitespace: true,
                conservativeCollapse: true,
                decodeEntities: true,
                minifyCSS: true,
                minifyJS: true,
                minifyURLs: true,
                preserveLineBreaks: false,
                quoteCharacter: '\'',
                removeComments: true,
                sortAttributes: true,
                sortClassName: true
            }
        })],
    },
}];
