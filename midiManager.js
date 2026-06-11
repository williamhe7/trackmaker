// midiManager.js
export class MidiManager {
    constructor(pianoManager, avgSpeed = 150) {
        this.pianoManager = pianoManager;
        this.avgSpeed = avgSpeed;
        this.notes = [];
        this.startTime = null;
    }

     async loadMIDI(file) {
    
        try {
    
            console.log("========== MIDI LOAD ==========");
    
            const arrayBuffer = await file.arrayBuffer();
    
            console.log(
                "file size:",
                arrayBuffer.byteLength
            );
    
            const midiData = MidiParser.parse(
                new Uint8Array(arrayBuffer)
            );
    
            console.log("MIDI DATA:");
            console.log(midiData);
    
            console.log(
                "timeDivision:",
                midiData.timeDivision
            );
    
            console.log(
                "track count:",
                midiData.track?.length
            );
    
            if (
                midiData.track &&
                midiData.track.length > 0
            ) {
    
                console.log(
                    "first event:",
                    midiData.track[0].event?.[0]
                );
    
                console.log(
                    "second event:",
                    midiData.track[0].event?.[1]
                );
    
                console.log(
                    "third event:",
                    midiData.track[0].event?.[2]
                );
            }
    
            this.notes = [];
    
            const tempo = 120;
            const ticksPerBeat =
                midiData.timeDivision || 480;
    
            const secondsPerBeat =
                60 / tempo;
    
            let totalEvents = 0;
            let noteOnCount = 0;
            let noteOffCount = 0;
    
            for (
                let trackIndex = 0;
                trackIndex < midiData.track.length;
                trackIndex++
            ) {
    
                const track =
                    midiData.track[trackIndex];
    
                console.log(
                    `TRACK ${trackIndex}`
                );
    
                let currentTicks = 0;
    
                const activeNotes =
                    new Map();
    
                for (
                    let eventIndex = 0;
                    eventIndex < track.event.length;
                    eventIndex++
                ) {
    
                    const event =
                        track.event[eventIndex];
    
                    totalEvents++;
    
                    currentTicks +=
                        event.deltaTime || 0;
    
                    if (eventIndex < 10) {
    
                        console.log(
                            `event ${eventIndex}:`,
                            event
                        );
                    }
    
                    const type =
                        event.type;
    
                    const data =
                        event.data;
    
                    if (
                        !Array.isArray(data)
                    ) {
                        continue;
                    }
    
                    // Note On
                    if (
                        type === 9 &&
                        data.length >= 2 &&
                        data[1] > 0
                    ) {
    
                        noteOnCount++;
    
                        const pitch =
                            data[0];
    
                        activeNotes.set(
                            pitch,
                            currentTicks
                        );
                    }
    
                    // Note Off
                    else if (
                        type === 8 ||
                        (
                            type === 9 &&
                            data.length >= 2 &&
                            data[1] === 0
                        )
                    ) {
    
                        noteOffCount++;
    
                        const pitch =
                            data[0];
    
                        if (
                            activeNotes.has(
                                pitch
                            )
                        ) {
    
                            const startTicks =
                                activeNotes.get(
                                    pitch
                                );
    
                            const startSec =
                                (
                                    startTicks /
                                    ticksPerBeat
                                ) *
                                secondsPerBeat;
    
                            const endSec =
                                (
                                    currentTicks /
                                    ticksPerBeat
                                ) *
                                secondsPerBeat;
    
                            this.notes.push({
                                signature:
                                    pitch,
    
                                start:
                                    startSec,
    
                                end:
                                    endSec,
    
                                length:
                                    (
                                        endSec -
                                        startSec
                                    ) *
                                    this.avgSpeed
                            });
    
                            activeNotes.delete(
                                pitch
                            );
                        }
                    }
                }
    
                console.log(
                    "remaining active notes:",
                    activeNotes.size
                );
            }
    
            this.notes.sort(
                (a, b) =>
                    a.start - b.start
            );
    
            console.log(
                "========== MIDI SUMMARY =========="
            );
    
            console.log(
                "events:",
                totalEvents
            );
    
            console.log(
                "note ons:",
                noteOnCount
            );
    
            console.log(
                "note offs:",
                noteOffCount
            );
    
            console.log(
                "notes created:",
                this.notes.length
            );
    
            if (
                this.notes.length > 0
            ) {
    
                console.log(
                    "first note:",
                    this.notes[0]
                );
    
                console.log(
                    "last note:",
                    this.notes[
                        this.notes.length - 1
                    ]
                );
    
                console.log(
                    "pitch range:",
                    Math.min(
                        ...this.notes.map(
                            n =>
                                n.signature
                        )
                    ),
                    Math.max(
                        ...this.notes.map(
                            n =>
                                n.signature
                        )
                    )
                );
            }
    
        } catch (e) {
    
            console.error(
                "MIDI parsing failed:",
                e
            );
        }
    }

    drawVisualization(ctx, canvasHeight, currentTime) {
        if (this.startTime === null) return;

        let found = 0;
        let missing = 0;
        for (const note of this.notes.slice(0, 100)) {
        
            const key = this.pianoManager.all_keys.find(
                k => k.signature === note.signature
            );
        
            if (key) found++;
            else missing++;
        }
        console.log("found:", found, "missing:", missing);

        const noteAreaH = canvasHeight * 0.6;
        ctx.save();

        for (let note of this.notes) {
            const yHead = (currentTime - note.start) * this.avgSpeed;
            const yTop = yHead - note.length;

            if (yHead < 0 || yTop > noteAreaH) continue;

            const key = this.pianoManager.all_keys.find(k => k.signature === note.signature);
            if (!key) continue;

            const clampedTop = Math.max(0, yTop);
            const clampedBottom = Math.min(noteAreaH, yHead);

            // Falling note
            ctx.fillStyle = key.isBlack ? 'rgba(220, 50, 50, 0.95)' : 'rgba(255, 80, 80, 0.9)';
            ctx.fillRect(key.x, clampedTop, key.width, clampedBottom - clampedTop);

            // Border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(key.x, clampedTop, key.width, clampedBottom - clampedTop);
        }

        ctx.restore();
    }
}
