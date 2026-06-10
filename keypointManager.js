// keypointManager.js
export class KeypointManager {
    constructor() {
        this.w = 1600;
        this.h = 1200;
        this.scale_dict = { 
            2: 1.07939633, 3: 2.15879265, 4: 3.23818898, 
            5: 4.31758530, 6: 5.39698163, 7: 6.47637795 
        };
        this.keys = [];
        this.homography = [];
        this.source = [];
        this.scale_factor = 1;
        this.scaled_width = 0;
        this.scaled_height = 0;
    }

    async getKeypoints(videoElement, session) {
        if (!session) return [];

        const inputSize = 1600;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = inputSize;
        tempCanvas.height = inputSize;
        const tctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(videoElement, 0, 0, inputSize, inputSize);

        const imageData = tctx.getImageData(0, 0, inputSize, inputSize);
        const data = new Float32Array(3 * inputSize * inputSize);

        for (let i = 0; i < inputSize * inputSize; i++) {
            const idx = i * 4;
            data[i] = imageData.data[idx] / 255.0;
            data[i + inputSize * inputSize] = imageData.data[idx + 1] / 255.0;
            data[i + 2 * inputSize * inputSize] = imageData.data[idx + 2] / 255.0;
        }

        const tensor = new ort.Tensor('float32', data, [1, 3, inputSize, inputSize]);
        
        let results;
        try {
            results = await session.run({ images: tensor });
        } catch (e) {
            results = await session.run({ "input.1": tensor });
        }

        const outputTensor = results.output0 || results.output || Object.values(results)[0];
        const rawOutput = outputTensor.data;

        return this.postProcessYOLOPose(rawOutput, inputSize);
    }

    postProcessYOLOPose(rawOutput, imgSize = 1600) {
        const detections = [];
        const confThreshold = 0.25;
        const valuesPerDetection = 23;

        const numDetections = Math.floor(rawOutput.length / valuesPerDetection);

        for (let i = 0; i < numDetections; i++) {
            const offset = i * valuesPerDetection;
            const confidence = rawOutput[offset + 4];

            if (confidence < confThreshold) continue;

            const kpts = [];
            const kptStart = 6;

            for (let k = 0; k < 6; k++) {
                const base = kptStart + k * 3;
                const x = rawOutput[offset + base] * imgSize;
                const y = rawOutput[offset + base + 1] * imgSize;
                const vis = rawOutput[offset + base + 2];

                if (vis > 0.5 && x > 10 && y > 10) {
                    kpts.push([x, y]);
                }
            }

            if (kpts.length >= 2) {
                detections.push(kpts);
            }
        }

        const sorted = this.sortByLowestX(detections);
        return sorted;
    }

    sortByLowestX(kpps) {
        if (!kpps || kpps.length === 0) return [];
        return kpps.sort((a, b) => {
            const minA = Math.min(...a.map(p => p[0]));
            const minB = Math.min(...b.map(p => p[0]));
            return minA - minB;
        });
    }

    computeHomography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys || [];

        if (keys.length < 2) {
            console.warn("Not enough key groups for homography");
            return;
        }

        for (let i = 0; i < keys.length - 1; i++) {
            const group1 = keys[i];
            const group2 = keys[i + 1];

            const lt = group1[0];
            const lb = group1[1];
            const rt = group2[0];
            const rb = group2[1];

            const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
                lt[0], lt[1], rt[0], rt[1], rb[0], rb[1], lb[0], lb[1]
            ]);

            const dstWidth = 800;
            const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0, dstWidth-1, 0, dstWidth-1, targetH-1, 0, targetH-1
            ]);

            const H = cv.getPerspectiveTransform(srcPoints, dstPoints);
            this.homography.push(H);
            this.source.push(srcPoints);
        }

        this.scale_factor = this.scale_dict[keys.length] || 1.0;
        console.log(`Homography computed for ${keys.length} key groups`);
    }

    // NEW: Matches Python transform_image exactly (using OpenCV.js)
    transformImage(videoElement) {
        if (this.keys.length < 2 || this.homography.length === 0) {
            return null; // fallback
        }

        // Create temp canvas for input frame (full res)
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        const srcW = videoElement.videoWidth || 1280;
        const srcH = videoElement.videoHeight || 720;
        tempCanvas.width = srcW;
        tempCanvas.height = srcH;
        tempCtx.drawImage(videoElement, 0, 0, srcW, srcH);

        let srcMat = cv.imread(tempCanvas);

        const imgList = [];

        for (let i = 0; i < this.keys.length - 1; i++) {
            const H = this.homography[i];
            const srcPts = this.source[i];

            // Warp full image
            const warpedFull = new cv.Mat();
            const dsizeFull = new cv.Size(srcW * 2, srcH * 2);
            cv.warpPerspective(srcMat, warpedFull, H, dsizeFull, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

            // Transform source points to find crop bounds
            const srcPointsMat = srcPts.clone(); // already 4x1 CV_32FC2
            const transformedMat = new cv.Mat();
            cv.perspectiveTransform(srcPointsMat, transformedMat, H);

            // Get min/max x for crop
            let minX = Infinity, maxX = -Infinity;
            const data = transformedMat.data32F;
            for (let j = 0; j < data.length; j += 2) {
                minX = Math.min(minX, data[j]);
                maxX = Math.max(maxX, data[j]);
            }

            const xMin = Math.max(0, Math.floor(minX));
            const xMax = Math.min(warpedFull.cols, Math.ceil(maxX));

            // Crop
            const rect = new cv.Rect(xMin, 0, xMax - xMin, warpedFull.rows);
            const cropped = warpedFull.roi(rect);

            // Resize height to target h (unify)
            const resized = new cv.Mat();
            cv.resize(cropped, resized, new cv.Size(cropped.cols, this.h), 0, 0, cv.INTER_LINEAR);

            imgList.push(resized);

            // Cleanup intermediates
            warpedFull.delete();
            transformedMat.delete();
            cropped.delete();
            srcPointsMat.delete();
        }

        // Combine horizontally
        let combined = imgList[0];
        for (let i = 1; i < imgList.length; i++) {
            const newCombined = new cv.Mat();
            cv.hconcat(combined, imgList[i], newCombined);
            combined.delete();
            combined = newCombined;
            imgList[i].delete();
        }

        // Final resize with scale
        const finalH = Math.round(combined.cols / this.scale_factor);
        const finalResized = new cv.Mat();
        cv.resize(combined, finalResized, new cv.Size(combined.cols, finalH), 0, 0, cv.INTER_CUBIC);

        // Rotate 180
        const rotated = new cv.Mat();
        cv.rotate(finalResized, rotated, cv.ROTATE_180);

        // Compute scaled dimensions (match Python screen logic - approximate)
        const screenHeightApprox = window.innerHeight * 0.5; // rough
        const scale = screenHeightApprox / rotated.rows;
        this.scaled_width = Math.round(rotated.cols * scale);
        this.scaled_height = Math.round(rotated.rows * scale);

        const finalMat = new cv.Mat();
        cv.resize(rotated, finalMat, new cv.Size(this.scaled_width, this.scaled_height));

        // Convert back to canvas for drawing
        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = this.scaled_width;
        resultCanvas.height = this.scaled_height;
        cv.imshow(resultCanvas, finalMat);

        // Cleanup
        srcMat.delete();
        combined.delete();
        finalResized.delete();
        rotated.delete();
        finalMat.delete();

        return resultCanvas;
    }
}
