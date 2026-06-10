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
        console.log(`Total output values: ${rawOutput.length}`);

        const detections = [];
        const confThreshold = 0.25;
        const valuesPerDetection = 23; // 4(bbox) + 1(obj) + 1(cls) + 6kpts*3 = 23

        const numDetections = Math.floor(rawOutput.length / valuesPerDetection);

        console.log(`Assuming ${numDetections} detections with ${valuesPerDetection} values each`);

        for (let i = 0; i < numDetections; i++) {
            const offset = i * valuesPerDetection;
            const confidence = rawOutput[offset + 4];

            if (confidence < confThreshold) continue;

            const kpts = [];
            const kptStart = 6; // after bbox(4) + obj(1) + cls(1)

            for (let k = 0; k < 6; k++) {  // 6 keypoints
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
        console.log(`✅ Found ${sorted.length} valid keypoint groups`);
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
}
