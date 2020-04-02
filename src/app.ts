import { Engine } from "@babylonjs/core/Engines/engine";
import { ImageFilter } from "@babylonjs/controls/dist/src/imageFilter";
import { PassPostProcess } from "@babylonjs/core/PostProcesses/passPostProcess";
import { BlackAndWhitePostProcess } from "@babylonjs/core/PostProcesses/blackAndWhitePostProcess";
import { GrainPostProcess } from "@babylonjs/core/PostProcesses/grainPostProcess";
import { ImageProcessingPostProcess } from "@babylonjs/core/PostProcesses/imageProcessingPostProcess";
import { ColorGradingTexture } from "@babylonjs/core/Materials/Textures/colorGradingTexture";

import "@babylonjs/core/Loading/loadingScreen";

import { AnimatedGifTexture } from "./animatedGifTexture";

// Find our elements
const mainCanvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const switchEffectButton = document.getElementById("switchEffectButton") as HTMLAnchorElement;

// By default Image Filter only creates a thin engine but here as we want to use
// post processes, we need to use our full engine
const engine = new Engine(mainCanvas);

engine.loadingScreen.loadingUIText = "Loading a Big Gif... Don't leave now :'("
engine.loadingScreen.displayLoadingUI();

const customFilter = new ImageFilter(engine);

// Create a pass through post process
const passPostProcess = new PassPostProcess("bw", 1, undefined, undefined, engine);

// Create the black and white post process
const blackAndWhitePostProcess = new BlackAndWhitePostProcess("bw", 1, null, undefined, engine);

const grainPostProcess = new GrainPostProcess("grain", 1, undefined, undefined, engine);
grainPostProcess.animated = true;
grainPostProcess.intensity *= 3;

// Create the Image Processing post process
const imageProcessingPostProcess = new ImageProcessingPostProcess("", 1, undefined, undefined, engine);
imageProcessingPostProcess.fromLinearSpace = false;

// Setup our ColorGrading effect
imageProcessingPostProcess.imageProcessingConfiguration.colorGradingEnabled = true;
imageProcessingPostProcess.imageProcessingConfiguration.colorGradingTexture = new ColorGradingTexture("./assets/lateSunset.3dl", engine);

// Creates a Gif Texture (looks simple ;-))
const gifTexture = new AnimatedGifTexture("assets/axe.gif", engine, () => {
    engine.loadingScreen.hideLoadingUI();
});

// Records all of our current effects
const allEffects = [passPostProcess,
    grainPostProcess,
    imageProcessingPostProcess,
    blackAndWhitePostProcess];

// And loop through them as requested
let currentEffectIndex = 0;
switchEffectButton.onclick = () => {
    currentEffectIndex = ++currentEffectIndex % allEffects.length;
}

// Rely on the underlying engine render loop to update the filter result every frame.
engine.runRenderLoop(() => {
    // Renders the gifTexture with our custom effect.
    customFilter.render(gifTexture, allEffects[currentEffectIndex]);
});