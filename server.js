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
// INITIALIZATION & SECRETS
// ---------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const app = express();
app.use(helmet({ contentSecurityPolicy: false })); // Disabled CSP temporarily to allow inline styles in our UI
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' }));

// Styling Arrays
const BACKGROUND_COLORS = ['#0f172a', '#1e1b4b', '#2e1065', '#27272a', '#052e16', '#171717'];
const BORDER_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171'];

// ---------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------
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
            try { fs.unlinkSync(file); } 
            catch (err) { console.error(`[CLEANUP] Failed to delete ${file}`); }
        }
    });
}

// ---------------------------------------------------------
// WEB DASHBOARD UI (The GET / Route)
// ---------------------------------------------------------
app.get('/', (req, res) => {
    const isSupabaseConnected = supabase !== null;
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Viral Video Engine Dashboard</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0d1117; color: #c9d1d9; margin: 0; padding: 40px; }
            .container { max-width: 800px; margin: 0 auto; background-color: #161b22; padding: 30px; border-radius: 12px; border: 1px solid #30363d; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
            h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
            .status-badge { display: inline-block; padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 14px; }
            .status-ok { background-color: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid #238636; }
            .status-warn { background-color: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid #9e6a03; }
            .card { background-color: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 20px; }
            pre { background-color: #161b22; padding: 15px; border-radius: 6px; overflow-x: auto; color: #8b949e; border: 1px solid #30363d; }
            .method { color: #a5d6ff; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Supabase Viral Engine</h1>
            
            <div class="card">
                <h3>System Status</h3>
                <p>Engine Core: <span class="status-badge status-ok">Online & Listening</span></p>
                <p>Supabase Connection: 
                    ${isSupabaseConnected 
                        ? '<span class="status-badge status-ok">Configured</span>' 
                        : '<span class="status-badge status-warn">Missing Environment Keys</span>'}
                </p>
            </div>

            <div class="card">
                <h3>API Reference</h3>
                <p><span class="method">POST</span> <code>/process-short</code></p>
                <p>Sends a job to the FFmpeg engine to download, crop, subtitle, and upload a video.</p>
                
                <h4>Required Payload (JSON):</h4>
                <pre>{
  "youtubeUrl": "https://www.youtube.com/watch?v=...",
  "startTime": 120.0,
  "endTime": 180.0,
  "fullTranscript": [
    { "start": 120.0, "end": 123.5, "text": "Example text..." }
  ]
}</pre>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// ---------------------------------------------------------
// THE VIDEO PROCESSING API (POST /process-short)
// ---------------------------------------------------------
app.post('/process-short', async (req, res) => {
    const { youtubeUrl, startTime, endTime, fullTranscript } = req.body;
    const jobId = uuidv4().substring(0, 8);

    if (!youtubeUrl || startTime === undefined || !fullTranscript) {
        return res.status(400).json({ error: 'Missing required payload data.' });
    }
    if (!supabase) {
        return res.status(500).json({ error: 'Supabase keys are missing in the server environment.' });
    }

    const srtFile = path.join(__dirname, `sub_${jobId}.srt`);
    const rawVideo = path.join(__dirname, `raw_${jobId}.mp4`);
    const finalVideo = path.join(__dirname, `final_${jobId}.mp4`);
    const finalFileName = `viral_short_${jobId}.mp4`;

    try {
        console.log(`\n[JOB ${jobId}] STARTED - URL: ${youtubeUrl}`);

        // 1. GENERATE SRT FILE
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

        // 2. DOWNLOAD CLIP (With upgraded anti-bot logic)
        console.log(`[JOB ${jobId}] Downloading segment...`);
        // --force-ipv4 and flexible formatting bypasses many Render IP blocks
        const downloadCmd = `yt-dlp --force-ipv4 -f "bestvideo[height<=1080]+bestaudio/best" --download-sections "*${startTime}-${endTime}" "${youtubeUrl}" -o "${rawVideo}"`;
        
        exec(downloadCmd, { maxBuffer: 1024 * 1024 * 10 }, async (dlError, stdout, stderr) => {
            if (dlError) {
                console.error(`\n[JOB ${jobId}] YT-DLP CRITICAL ERROR:\n`, stderr);
                cleanupFiles([srtFile, rawVideo]);
                return res.status(500).json({ error: 'Download failed. Check Render logs for yt-dlp stderr.', details: stderr });
            }

            // 3. THE MAGIC FFmpeg BUILDER
            const bgColor = BACKGROUND_COLORS[Math.floor(Math.random() * BACKGROUND_COLORS.length)];
            const borderColor = BORDER_COLORS[Math.floor(Math.random() * BORDER_COLORS.length)];
            
            let bgmCommand = '';
            let audioFilter = '-c:a copy'; 
            const bgmDir = path.join(__dirname, 'bgm');
            
            if (fs.existsSync(bgmDir)) {
                const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3'));
                if (files.length > 0) {
                    const randomBgm = path.join(bgmDir, files[Math.floor(Math.random() * files.length)]);
                    console.log(`[JOB ${jobId}] Applying BGM: ${randomBgm}`);
                    bgmCommand = `-stream_loop -1 -i "${randomBgm}"`;
                    audioFilter = `-filter_complex "[0:a]volume=1.0[main];[1:a]volume=0.10[bgm];[main][bgm]amix=inputs=2:duration=first:dropout_transition=0" -c:a aac`;
                }
            }

            console.log(`[JOB ${jobId}] Composing Video (Colors: ${bgColor}, ${borderColor})...`);
            
            // Render Free Tier trick: -preset ultrafast uses less RAM to prevent OOM crashes
            const videoFilter = `-vf "scale=1000:-1:force_original_aspect_ratio=decrease,pad=1020:ih+20:(ow-iw)/2:(oh-ih)/2:color='${borderColor}',pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color='${bgColor}',subtitles=${srtFile}:force_style='Fontname=Liberation Sans,FontSize=24,PrimaryColour=&H00FFFF,Outline=1,Shadow=2,MarginV=120'"`;

            const ffmpegCmd = `ffmpeg -i "${rawVideo}" ${bgmCommand} ${videoFilter} ${audioFilter} -c:v libx264 -preset ultrafast -shortest "${finalVideo}"`;

            exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 10 }, async (ffError, ffStdout, ffStderr) => {
                if (ffError) {
                    console.error(`\n[JOB ${jobId}] FFMPEG CRITICAL ERROR:\n`, ffStderr);
                    cleanupFiles([srtFile, rawVideo, finalVideo]);
                    return res.status(500).json({ error: 'Video processing failed. Check Render logs.', details: ffStderr });
                }

                // 4. UPLOAD TO SUPABASE
                console.log(`[JOB ${jobId}] Uploading to Supabase...`);
                try {
                    const videoBuffer = fs.readFileSync(finalVideo);
                    const { data, error } = await supabase.storage
                        .from('shorts') 
                        .upload(finalFileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

                    if (error) throw error;

                    const { data: publicUrlData } = supabase.storage.from('shorts').getPublicUrl(finalFileName);
                    console.log(`[JOB ${jobId}] Success! Video at: ${publicUrlData.publicUrl}`);

                    cleanupFiles([srtFile, rawVideo, finalVideo]);

                    res.status(200).json({ 
                        message: 'Video created and uploaded to Supabase successfully!',
                        videoUrl: publicUrlData.publicUrl,
                        jobId: jobId
                    });

                } catch (supaError) {
                    console.error(`[JOB ${jobId}] Supabase upload failed:`, supaError);
                    cleanupFiles([srtFile, rawVideo, finalVideo]);
                    res.status(500).json({ error: 'Failed to upload to Supabase.', details: supaError.message });
                }
            });
        });

    } catch (error) {
        console.error(`[JOB ${jobId}] Fatal crash:`, error);
        cleanupFiles([srtFile, rawVideo, finalVideo]);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Supabase Viral Engine listening on port ${PORT}`));
