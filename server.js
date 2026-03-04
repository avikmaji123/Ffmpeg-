const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------
// SECRETS & SETUP
// ---------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// RAPID API CONFIGURATION (Hardcoded per user request)
const RAPID_API_KEY = '101e45da46mshd04f6e6082b3db7p129faejsn4ed51f268ffc';
const RAPID_API_HOST = 'youtube-video-fast-downloader2.p.rapidapi.com'; 

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' }));

const processQueue = new Map();

function formatSrtTime(seconds) {
    const date = new Date(Math.max(0, seconds) * 1000);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch (err) {}
        }
    });
}

// ---------------------------------------------------------
// V14 CYBER-DASHBOARD
// ---------------------------------------------------------
app.get('/', (req, res) => {
    const isSupabaseConnected = supabase !== null;
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NEXUS V14 | RAPID-API</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body { background-color: #050505; }
            .glass { background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(56, 189, 248, 0.2); }
            .neon-text { text-shadow: 0 0 10px rgba(56, 189, 248, 0.5); }
        </style>
    </head>
    <body class="text-gray-300 font-mono min-h-screen p-4 md:p-8">
        <div class="max-w-5xl mx-auto space-y-6">
            <header class="border-b border-sky-900 pb-4 mb-8">
                <h1 class="text-4xl font-black text-sky-400 neon-text tracking-tighter">NEXUS V14 TITAN</h1>
                <p class="text-gray-500 text-sm mt-1">Enterprise RapidAPI Integration & Cinematic Engine</p>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="glass p-5 rounded-xl col-span-1 h-fit">
                    <h2 class="text-xl font-bold text-white mb-4">System Core</h2>
                    <ul class="space-y-3 text-sm">
                        <li class="flex justify-between"><span>Supabase Node:</span> ${isSupabaseConnected ? '<span class="text-green-400 font-bold">CONNECTED</span>' : '<span class="text-red-500 font-bold">DISCONNECTED</span>'}</li>
                        <li class="flex justify-between border-t border-gray-800 pt-3"><span>Bot Evasion:</span> <span class="text-purple-400 font-bold">RAPID-API ACTIVE</span></li>
                        <li class="flex justify-between"><span>Local Extractor:</span> <span class="text-gray-500 font-bold">DISABLED (yt-dlp removed)</span></li>
                    </ul>
                </div>

                <div class="glass p-5 rounded-xl col-span-1 md:col-span-2">
                    <form id="jobForm" class="space-y-4">
                        <div>
                            <label class="block text-xs text-sky-500 uppercase mb-1">Target URL</label>
                            <input type="text" id="youtubeUrl" value="https://www.youtube.com/watch?v=QY6yHJC2DIE" class="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-sky-500">
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs text-sky-500 uppercase mb-1">Start Time (s)</label>
                                <input type="number" id="startTime" value="730" class="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-sky-500">
                            </div>
                            <div>
                                <label class="block text-xs text-sky-500 uppercase mb-1">End Time (s)</label>
                                <input type="number" id="endTime" value="740" class="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-sky-500">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs text-sky-500 uppercase mb-1">Watermark Overlay</label>
                            <input type="text" id="watermark" value="@avik_911" class="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-sky-500">
                        </div>
                        <button type="submit" class="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold py-3 rounded transition-all shadow-[0_0_15px_rgba(2,132,199,0.5)] uppercase tracking-widest mt-4">Initialize Rapid Render</button>
                    </form>
                </div>
            </div>

            <div id="output-terminal" class="glass p-5 rounded-xl hidden">
                <div class="bg-gray-950 p-4 rounded border border-gray-800 font-mono text-sm">
                    <p id="job-id-display" class="text-gray-500 mb-2"></p>
                    <p id="job-status" class="text-sky-400 animate-pulse">Awaiting initialization...</p>
                    <div id="result-link" class="mt-4 hidden p-3 bg-green-900/30 border border-green-800 rounded"></div>
                </div>
            </div>
        </div>

        <script>
            document.getElementById('jobForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const term = document.getElementById('output-terminal');
                const statusText = document.getElementById('job-status');
                const jobIdText = document.getElementById('job-id-display');
                const resultLink = document.getElementById('result-link');
                
                term.classList.remove('hidden');
                statusText.innerText = "Dispatching job to server...";
                resultLink.classList.add('hidden');

                const payload = {
                    youtubeUrl: document.getElementById('youtubeUrl').value,
                    startTime: parseFloat(document.getElementById('startTime').value),
                    endTime: parseFloat(document.getElementById('endTime').value),
                    watermarkText: document.getElementById('watermark').value,
                    fullTranscript: [
                        { start: 730.0, end: 734.0, text: "V14 RapidAPI Engine online." },
                        { start: 734.5, end: 737.0, text: "Authenticating premium proxy mesh." },
                        { start: 737.5, end: 740.0, text: "Bypassing YouTube blocks completely." }
                    ]
                };

                try {
                    const res = await fetch('/process-short', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    const data = await res.json();
                    if(data.jobId) {
                        jobIdText.innerText = \`JOB ID: \${data.jobId}\`;
                        pollStatus(data.jobId);
                    } else {
                        statusText.innerText = "Error: " + (data.error || "Failed to start.");
                        statusText.className = "text-red-500";
                    }
                } catch(err) {
                    statusText.innerText = "Critical API Failure.";
                    statusText.className = "text-red-500";
                }
            });

            async function pollStatus(jobId) {
                const statusText = document.getElementById('job-status');
                const resultLink = document.getElementById('result-link');
                
                const interval = setInterval(async () => {
                    try {
                        const res = await fetch(\`/status/\${jobId}\`);
                        const data = await res.json();
                        
                        statusText.innerText = \`> \${data.status}...\`;
                        
                        if(data.status === 'Completed') {
                            clearInterval(interval);
                            statusText.innerText = "> SEQUENCE COMPLETE.";
                            statusText.className = "text-green-500 font-bold";
                            resultLink.classList.remove('hidden');
                            resultLink.innerHTML = \`Payload secured at: <a href="\${data.url}" target="_blank" class="text-sky-400 underline break-all">\${data.url}</a>\`;
                        } else if(data.status.startsWith('Failed')) {
                            clearInterval(interval);
                            statusText.innerText = \`> \${data.status} - \${data.error || ''}\`;
                            statusText.className = "text-red-500 font-bold";
                        }
                    } catch(err) {
                        console.error(err);
                    }
                }, 3000);
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/status/:jobId', (req, res) => {
    const job = processQueue.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job ID not found or expired.' });
    res.json(job);
});

// ---------------------------------------------------------
// ASYNC PROCESS ROUTE
// ---------------------------------------------------------
app.post('/process-short', async (req, res) => {
    const { youtubeUrl, startTime, endTime, fullTranscript, watermarkText } = req.body;
    const jobId = uuidv4().substring(0, 8);
    const finalWatermark = watermarkText || '@avik_911';

    if (!youtubeUrl || startTime === undefined || !fullTranscript || !supabase) {
        return res.status(400).json({ error: 'Missing payload or Supabase setup.' });
    }

    res.status(202).json({ message: 'Job accepted.', jobId: jobId });
    processQueue.set(jobId, { status: 'Extraction initiated', url: null });
    
    const srtFile = path.join(__dirname, `sub_${jobId}.srt`);
    const finalVideo = path.join(__dirname, `final_${jobId}.mp4`);
    const finalFileName = `viral_short_${jobId}.mp4`;

    try {
        console.log(`\n[JOB ${jobId}] Engine Started...`);

        // 1. Generate Subtitles
        processQueue.set(jobId, { status: 'Compiling Subtitles (SRT)' });
        let srtContent = '';
        let subtitleIndex = 1;
        fullTranscript.forEach(line => {
            if (line.start >= startTime && line.end <= endTime) {
                const startMath = line.start - startTime;
                const endMath = line.end - startTime;
                srtContent += `${subtitleIndex}\n${formatSrtTime(startMath)} --> ${formatSrtTime(endMath)}\n${line.text}\n\n`;
                subtitleIndex++;
            }
        });
        fs.writeFileSync(srtFile, srtContent);

        // 2. Fetch Direct URL via RapidAPI
        processQueue.set(jobId, { status: 'Authenticating with RapidAPI...' });
        
        const videoIdMatch = youtubeUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if(!videoId) {
            processQueue.set(jobId, { status: 'Failed: Invalid YouTube URL format' });
            return cleanupFiles([srtFile]);
        }

        const rapidApiUrl = `https://${RAPID_API_HOST}/getVideo?id=${videoId}`;
        
        try {
            const apiResponse = await fetch(rapidApiUrl, {
                method: 'GET',
                headers: {
                    'x-rapidapi-key': RAPID_API_KEY,
                    'x-rapidapi-host': RAPID_API_HOST
                }
            });

            const apiData = await apiResponse.json();

            // Find the highest quality MP4 link from the RapidAPI response
            let directUrl = null;
            if (apiData && apiData.links && apiData.links.length > 0) {
                // Filter for mp4 and sort by quality (1080p, 720p, etc)
                const mp4Links = apiData.links.filter(link => link.ext === 'mp4' && link.url);
                if (mp4Links.length > 0) {
                    directUrl = mp4Links[0].url; // Grabs the first/best one
                }
            }

            if (!directUrl) {
                 processQueue.set(jobId, { status: 'Failed: RapidAPI did not return a valid MP4 link.', error: JSON.stringify(apiData) });
                 return cleanupFiles([srtFile]);
            }

            console.log(`[JOB ${jobId}] RapidAPI Success! Direct URL obtained.`);
            processQueue.set(jobId, { status: 'Cloud Streaming & Applying Cinematic Edits...' });

            // 3. Cinematic FFmpeg Builder (Directly streaming from the RapidAPI URL)
            let bgmCommand = '';
            let audioFilter = '-c:a copy'; 
            const bgmDir = path.join(__dirname, 'bgm');
            if (fs.existsSync(bgmDir)) {
                const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3'));
                if (files.length > 0) {
                    const randomBgm = path.join(bgmDir, files[Math.floor(Math.random() * files.length)]);
                    bgmCommand = `-stream_loop -1 -i "${randomBgm}"`;
                    audioFilter = `-filter_complex "[0:a]volume=1.0[main];[1:a]volume=0.10[bgm];[main][bgm]amix=inputs=2:duration=first:dropout_transition=0" -c:a aac`;
                }
            }

            // Cinematic padding (dark slate), dynamic watermark at the top, high-vis subtitles at the bottom
            const videoFilter = `-vf "scale=1000:-1:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color='#0f172a',drawtext=text='${finalWatermark}':fontcolor=white@0.4:fontsize=46:x=(w-text_w)/2:y=150,subtitles=${srtFile}:force_style='Fontname=Liberation Sans,FontSize=26,PrimaryColour=&H00FFFF,Outline=1,Shadow=2,MarginV=250'"`;
            
            // Cloud Streaming FFmpeg Command (No local downloading required)
            const ffmpegCmd = `ffmpeg -y -ss ${startTime} -to ${endTime} -i "${directUrl}" ${bgmCommand} ${videoFilter} ${audioFilter} -c:v libx264 -preset veryfast -crf 28 -threads 2 "${finalVideo}"`;

            exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 10 }, async (ffError, ffStdout, ffStderr) => {
                if (ffError) {
                    processQueue.set(jobId, { status: 'Failed: FFmpeg Render Error', error: 'Could not stream video from RapidAPI link.' });
                    return cleanupFiles([srtFile, finalVideo]);
                }

                processQueue.set(jobId, { status: 'Uploading Final Short to Supabase...' });
                try {
                    const videoBuffer = fs.readFileSync(finalVideo);
                    const { data, error } = await supabase.storage.from('shorts').upload(finalFileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

                    if (error) throw error;

                    const { data: publicUrlData } = supabase.storage.from('shorts').getPublicUrl(finalFileName);
                    processQueue.set(jobId, { status: 'Completed', url: publicUrlData.publicUrl });
                    cleanupFiles([srtFile, finalVideo]);

                    setTimeout(() => processQueue.delete(jobId), 3600000);

                } catch (supaError) {
                    processQueue.set(jobId, { status: 'Failed: Supabase Upload Error', error: supaError.message });
                    cleanupFiles([srtFile, finalVideo]);
                }
            });

        } catch (apiError) {
             processQueue.set(jobId, { status: 'Failed: RapidAPI Network Error', error: apiError.message });
             cleanupFiles([srtFile]);
        }

    } catch (error) {
        processQueue.set(jobId, { status: 'Failed: Fatal Core Error' });
        cleanupFiles([srtFile, finalVideo]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 NEXUS V14 Online on port ${PORT}`));
        
