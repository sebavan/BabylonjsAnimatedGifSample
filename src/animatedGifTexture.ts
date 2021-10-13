import { Nullable } from "@babylonjs/core/types";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ThinEngine } from "@babylonjs/core/Engines/thinEngine";
import { PrecisionDate } from "@babylonjs/core/Misc/precisionDate";
import { EffectWrapper, EffectRenderer } from "@babylonjs/core/Materials/effectRenderer";
import { InternalTexture } from "@babylonjs/core/Materials/Textures/internalTexture";
import { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper";

// Ensures Raw texture are included
import "@babylonjs/core/Engines/Extensions/engine.rawTexture";

// Import our Shader Config
import { AnimatedGifShaderConfiguration } from "./animatedGifTextureShader";

// Gifs external library to parse Gif datas
import { parseGIF, decompressFrames } from "Gifuct-js";

/**
 * Typings related to our Gif library as it does not includ a d ts file.
 */
declare type GifFrame = {
    /**
     * Current Frame dimensions.
     */
    dims: {
        width: number,
        height: number,
        top: number,
        left: number,
    },
    /**
     * Current Frame content as RGBA.
     */
    patch: Uint8ClampedArray,
    /**
     * Current Frame visible time.
     */
    delay: number,
    /**
     * Current Frame associated texture.
     */
    texture: InternalTexture;
    /**
     * Current Transform Matrix to handle the patch scale and translation.
     */
    worldMatrix: Float32Array;
};

/**
 * This represents an animated Gif textures.
 * Yes... It is truly animating ;-)
 */
export class AnimatedGifTexture extends BaseTexture {
    private _onLoad: Nullable<() => void>

    private _frames: Nullable<GifFrame[]> = null;
    private _currentFrame: Nullable<GifFrame>;
    private _nextFrameIndex = 0;
    private _previousDate: number;

    private _patchEffectWrapper: EffectWrapper;
    private _patchEffectRenderer: EffectRenderer;
    private _renderLoopCallback: () => void;

    private _renderTarget: RenderTargetWrapper;

    /**
     * Instantiates an AnimatedGifTexture from the following parameters.
     *
     * @param url The location of the Gif
     * @param engine engine the texture will be used in
     * @param onLoad defines a callback to trigger once all ready.
     */
    constructor(url: string, engine: ThinEngine, onLoad: Nullable<() => void> = null) {
        super(engine);

        this.name = url;
        this._onLoad = onLoad;

        this._createInternalTexture();
        this._createRenderer();
        this._createRenderLoopCallback();
        this._loadGifTexture();
    }

    /**
     * Creates the internal texture used by the engine.
     */
    private _createInternalTexture(): void {
        this._texture = this._engine.createRawTexture(null, 1, 1, Constants.TEXTUREFORMAT_RGBA, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, null, Constants.TEXTURETYPE_UNSIGNED_INT);

        // Do not be ready before the data has been loaded
        this._texture.isReady = false;

        // Setups compatibility with gl1
        this.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        this.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        this.wrapR = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        this.anisotropicFilteringLevel = 1;
    }

    /**
     * Create the renderer resources used to draw the Gif patches in the texture.
     */
    private _createRenderer(): void {
        // Creates a wrapper around our custom shader
        this._patchEffectWrapper = new EffectWrapper({
            ...AnimatedGifShaderConfiguration,
            engine: this._engine,
        });

        // Creates a dedicated fullscreen renderer for the frame blit
        this._patchEffectRenderer = new EffectRenderer(this._engine, {
            positions: [1, 1, 0, 1, 0, 0, 1, 0]
        });
    }

    /**
     * Creates the current render loop callback.
     */
    private _createRenderLoopCallback(): void {
        this._renderLoopCallback = () => {
            this._renderFrame();
        };
    }

    /**
     * Starts loading the Gif data.
     */
    private _loadGifTexture(): void {
        // Defines what happens after we read the data from the url
        const callback = (buffer: ArrayBuffer) => {
            this._parseGifData(buffer);
            this._createGifResources();

            // Start Rendering the sequence of frames
            this._engine.runRenderLoop(this._renderLoopCallback);
        };

        // Load the array buffer from the Gif file
        this._engine._loadFile(this.name, callback, undefined, undefined, true);
    }

    /**
     * Parses the Gif data and creates the associated frames.
     * @param buffer Defines the buffer containing the data
     */
    private _parseGifData(buffer: ArrayBuffer): void {
        const gifData = parseGIF(buffer);
        this._frames = decompressFrames(gifData, true);
    }

    /**
     * Creates the GPU resources associated with the Gif file.
     * It will create the texture for each frame as well as our render target used
     * to hold the final Gif.
     */
    private _createGifResources(): void {
        for (let frame of this._frames) {
            // Creates a dedicated texture for each frames
            // This only contains patched data for a portion of the image
            frame.texture = this._engine.createRawTexture(new Uint8Array(frame.patch.buffer),
                frame.dims.width, 
                frame.dims.height, 
                Constants.TEXTUREFORMAT_RGBA, 
                false,
                true,
                Constants.TEXTURE_NEAREST_SAMPLINGMODE, 
                null,
                Constants.TEXTURETYPE_UNSIGNED_INT);

            // As it only contains part of the image, we need to translate and scale
            // the rendering of the pacth to fit with the location data from the file
            const sx = frame.dims.width / this._frames[0].dims.width;
            const sy = frame.dims.height / this._frames[0].dims.height;
            const tx = frame.dims.left / this._frames[0].dims.width;
            // As we render from the bottom, the translation needs to be computed accordingly
            const ty = (this._frames[0].dims.height - (frame.dims.top + frame.dims.height)) / this._frames[0].dims.height;
            frame.worldMatrix = new Float32Array([
                sx, 0, tx,
                0, sy, ty,
                0,  0, 1,
            ]);

            // Ensures webgl 1 compat
            this._engine.updateTextureWrappingMode(frame.texture, Constants.TEXTURE_CLAMP_ADDRESSMODE, Constants.TEXTURE_CLAMP_ADDRESSMODE);
        }

        // Creates our main render target based on the Gif dimensions
        this._renderTarget = this._engine.createRenderTargetTexture(this._frames[0].dims, { 
            format: Constants.TEXTUREFORMAT_RGBA,
            generateDepthBuffer: false,
            generateMipMaps: false,
            generateStencilBuffer: false,
            samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            type: Constants.TEXTURETYPE_UNSIGNED_BYTE
        });

        // Release the extra resources from the current internal texture
        this._engine._releaseTexture(this._texture);

        // Swap our internal texture by our new render target one
        this._renderTarget.texture._swapAndDie(this._texture);

        // And adapt its data
        this._engine.updateTextureWrappingMode(this._texture, Constants.TEXTURE_CLAMP_ADDRESSMODE, Constants.TEXTURE_CLAMP_ADDRESSMODE);
        this._texture.width = this._frames[0].dims.width;
        this._texture.height = this._frames[0].dims.height;
        this._texture.isReady = false;
    }

    /**
     * Render the current frame when all is ready.
     */
    private _renderFrame(): void {
        // Keep the current frame as long as specified in the Gif data
        if (this._currentFrame && (PrecisionDate.Now - this._previousDate) < this._currentFrame.delay) {
            return;
        }

        // Replace the current frame
        this._currentFrame = this._frames[this._nextFrameIndex];

        // Patch the texture
        this._drawPatch();

        // Recall the current draw time for this frame.
        this._previousDate = PrecisionDate.Now;

        // Update the next frame index
        this._nextFrameIndex++;
        if (this._nextFrameIndex >= this._frames.length) {
            this._nextFrameIndex = 0;
        }
    }

    /**
     * Draw the patch texture on top of the previous one.
     */
    private _drawPatch(): void {
        // The texture is only ready when we are able to render
        if (!this._patchEffectWrapper.effect.isReady()) {
            return;
        }

        // Get the current frame
        const frame: GifFrame = this._currentFrame;

        // Record the old viewport
        const oldViewPort = this._engine.currentViewport;

        // We need to apply our special inputes to the effect when it renders
        this._patchEffectWrapper.onApplyObservable.addOnce(() => {
            this._patchEffectWrapper.effect.setMatrix3x3("world", frame.worldMatrix);
            this._patchEffectWrapper.effect._bindTexture("textureSampler", frame.texture);
        });

        // Render the current Gif frame on top of the previous one
        this._patchEffectRenderer.render(this._patchEffectWrapper, this._renderTarget);

        // Reset the old viewport
        this._engine.setViewport(oldViewPort);

        // We are now all ready to roll
        if (!this._texture.isReady) {
            this._texture.isReady = true;
            this._onLoad && this._onLoad();
        }
    }
    /**
     * Dispose the texture and release its associated resources.
     */
    public dispose(): void {
        // Stops the current Gif update loop
        this._engine.stopRenderLoop(this._renderLoopCallback);

        // Clear the render helpers
        this._patchEffectWrapper.dispose();
        this._patchEffectRenderer.dispose();

        // Clear the textures from the Gif
        for (let frame of this._frames) {
            frame.texture.dispose();
        }

        this._renderTarget.dispose();

        // Disposes the render target associated resources
        super.dispose();
    }
}
