require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws'); // Moved and changed to general WebSocket
const { WebSocketServer } = require('ws'); // Kept for the server
const connectDB = require('./config/db');
const dotenv = require('dotenv'); // Added from snippet (redundant with .config() but included as per instruction)
const { storage, bucket } = require('./config/storage'); // Added from snippet
const Book = require('./models/Book'); // Added from snippet
const Page = require('./models/Page'); // Added from snippet
const TTSCache = require('./models/TTSCache'); // Added from snippet
const crypto = require('crypto'); // Added from snippet
const fs = require('fs'); // Added from snippet
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
connectDB();

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads'))); // Moved from snippet

// Routes
app.use('/api/books', require('./routes/books'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/authentication', require('./routes/authentication'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tts', require('./routes/tts'));

app.get('/', (req, res) => {
  res.send('Godly Kids Backend API is running');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// WebSocket Server for TTS
const wss = new WebSocketServer({ server, path: '/api/tts/ws' });

wss.on('connection', (ws) => {
  console.log('TTS WebSocket client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      const { text, voiceId, bookId } = data;

      if (!text || !voiceId) {
        ws.send(JSON.stringify({ error: 'Text and voiceId are required' }));
        return;
      }

      // Connect to ElevenLabs WebSocket
      const apiKey = process.env.ELEVENLABS_API_KEY;
      console.log('🔑 ElevenLabs API Key loaded:', apiKey ? `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}` : 'MISSING');

      if (!apiKey) {
        console.error('❌ ELEVENLABS_API_KEY is missing in .env file');
        ws.send(JSON.stringify({ error: 'ElevenLabs API key not configured' }));
        return;
      }

      const elevenLabsWs = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
        {
          headers: {
            'xi-api-key': apiKey
          }
        }
      );

      const audioChunks = [];
      let alignmentData = null;
      let wordAlignment = [];

      elevenLabsWs.on('open', () => {
        console.log('Connected to ElevenLabs WebSocket');
        // Send text to ElevenLabs
        elevenLabsWs.send(JSON.stringify({
          text: text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          },
          generation_config: {
            chunk_length_schedule: [120, 160, 250, 350]
          }
        }));
      });

      elevenLabsWs.on('message', (data) => {
        try {
          // Try to parse as JSON (for alignment/metadata)
          const messageStr = data.toString();
          if (messageStr.startsWith('{')) {
            const message = JSON.parse(messageStr);
            console.log('📨 ElevenLabs message:', JSON.stringify(message).substring(0, 200));

            if (message.alignment) {
              // Alignment data with character-level timestamps
              alignmentData = message.alignment;
              console.log('📊 Alignment data received:', JSON.stringify(alignmentData).substring(0, 300));

              // Convert character-level to word-level alignment
              if (alignmentData.chars && alignmentData.charStartTimesMs && alignmentData.charDurationsMs) {
                const words = text.split(/\s+/).filter(w => w.length > 0);
                wordAlignment = [];
                let charIndex = 0;

                console.log('🔄 Converting character-level to word-level alignment');
                console.log('📊 Input:', {
                  totalChars: alignmentData.chars.length,
                  totalWords: words.length,
                  firstChars: alignmentData.chars.slice(0, 20).join(''),
                  firstStartTimes: alignmentData.charStartTimesMs.slice(0, 10)
                });

                words.forEach((word, wordIdx) => {
                  const wordStartChar = charIndex;
                  const wordEndChar = charIndex + word.length;

                  if (wordStartChar < alignmentData.chars.length && wordEndChar <= alignmentData.chars.length) {
                    const startTime = alignmentData.charStartTimesMs[wordStartChar] / 1000; // Convert to seconds
                    let endTime = startTime;

                    // Calculate end time from last character
                    for (let i = wordStartChar; i < wordEndChar && i < alignmentData.charDurationsMs.length; i++) {
                      endTime += alignmentData.charDurationsMs[i] / 1000;
                    }

                    wordAlignment.push({
                      word: word,
                      start: startTime,
                      end: endTime
                    });

                    // Log first few words for debugging
                    if (wordIdx < 5) {
                      console.log(`  Word ${wordIdx}: "${word}" [${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s]`);
                    }
                  }

                  charIndex += word.length + 1; // +1 for space
                });

                // Send word alignment to client
                console.log('✅ Sending word alignment:', wordAlignment.length, 'words');
                console.log('📊 Timing range:', {
                  first: wordAlignment[0],
                  last: wordAlignment[wordAlignment.length - 1]
                });
                ws.send(JSON.stringify({
                  type: 'alignment',
                  words: wordAlignment
                }));
              } else {
                console.warn('⚠️ Alignment data missing required fields:', {
                  hasChars: !!alignmentData.chars,
                  hasStartTimes: !!alignmentData.charStartTimesMs,
                  hasDurations: !!alignmentData.charDurationsMs
                });
              }
            } else {
              console.log('ℹ️ No alignment in message, keys:', Object.keys(message));
            }

            if (message.audio) {
              // Base64 audio chunk
              const audioBuffer = Buffer.from(message.audio, 'base64');
              audioChunks.push(audioBuffer);

              // Forward to client as base64
              ws.send(JSON.stringify({
                type: 'audio',
                data: message.audio
              }));
            }

            if (message.isFinal) {
              console.log('ElevenLabs stream complete');
            }
          } else {
            // Binary audio data
            if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
              const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
              audioChunks.push(buffer);

              // Convert to base64 and send to client
              ws.send(JSON.stringify({
                type: 'audio',
                data: buffer.toString('base64')
              }));
            }
          }
        } catch (err) {
          // Binary audio data - try to send as base64
          if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            audioChunks.push(buffer);

            ws.send(JSON.stringify({
              type: 'audio',
              data: buffer.toString('base64')
            }));
          } else {
            console.error('Error processing WebSocket message:', err);
          }
        }
      });

      elevenLabsWs.on('error', async (error) => {
        console.error('ElevenLabs WebSocket error:', error);
        console.log('⚠️ Falling back to HTTP API for TTS');

        // Fallback to HTTP API
        try {
          console.log('🔄 Starting HTTP fallback for TTS...');
          const axios = require('axios');
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
              text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75
              }
            },
            {
              headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer',
              params: {
                output_format: 'mp3_44100_128'
              }
            }
          );

          console.log('✅ HTTP API response received, size:', response.data.length, 'bytes');

          // Save audio
          const crypto = require('crypto');
          const textHash = crypto.createHash('md5').update(text).digest('hex');
          const filename = `${Date.now()}_${textHash}.mp3`;
          const { bucket } = require('./config/storage');
          const filePath = bookId ? `books/${bookId}/audio/${filename}` : `audio/${filename}`;

          let audioUrl;
          if (bucket && process.env.GCS_BUCKET_NAME) {
            const blob = bucket.file(filePath);
            await new Promise((resolve, reject) => {
              const blobStream = blob.createWriteStream({
                metadata: { contentType: 'audio/mpeg' }
              });
              blobStream.on('error', reject);
              blobStream.on('finish', () => {
                audioUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                resolve();
              });
              blobStream.end(Buffer.from(response.data));
            });
          } else {
            const fs = require('fs');
            const uploadsDir = path.join(__dirname, '../../uploads');
            const localPath = path.join(uploadsDir, filePath);
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(localPath, Buffer.from(response.data));
            audioUrl = `/uploads/${filePath}`;
          }

          // Generate estimated alignment
          const words = text.split(/\s+/).filter(w => w.length > 0);
          const estimatedDurationPerWord = 0.4;
          const wordAlignment = words.map((word, index) => ({
            word,
            start: index * estimatedDurationPerWord,
            end: (index + 1) * estimatedDurationPerWord
          }));

          // Cache result
          const TTSCache = require('./models/TTSCache');
          await TTSCache.findOneAndUpdate(
            { textHash, voiceId },
            {
              textHash,
              voiceId,
              text,
              audioUrl,
              alignmentData: { words: wordAlignment }
            },
            { upsert: true, new: true }
          );

          // Send to client
          console.log('✅ HTTP fallback successful, sending audio URL:', audioUrl);
          console.log('📤 Sending complete message to client...');
          ws.send(JSON.stringify({
            type: 'complete',
            audioUrl: audioUrl,
            alignment: { words: wordAlignment }
          }));

          // Wait longer to ensure client receives the message before closing
          console.log('⏳ Waiting 2 seconds before closing WebSocket to ensure message delivery...');
          setTimeout(() => {
            if (ws.readyState === require('ws').OPEN) {
              console.log('🔌 Closing WebSocket after successful HTTP fallback');
              ws.close();
            }
          }, 2000); // Increased from 100ms to 2000ms
        } catch (fallbackError) {
          console.error('❌ HTTP fallback failed:', fallbackError.message);
          if (fallbackError.response) {
            console.error('Response status:', fallbackError.response.status);
            console.error('Response data:', fallbackError.response.data?.toString().substring(0, 200));
          }
          ws.send(JSON.stringify({
            error: 'TTS generation failed',
            message: fallbackError.response?.data?.message || fallbackError.message
          }));
          setTimeout(() => {
            if (ws.readyState === require('ws').OPEN) {
              ws.close();
            }
          }, 100);
        }
      });

      elevenLabsWs.on('close', async () => {
        console.log('ElevenLabs WebSocket closed');

        // Combine all audio chunks
        if (audioChunks.length > 0) {
          const fullAudio = Buffer.concat(audioChunks);

          // Save audio file
          const textHash = require('crypto').createHash('md5').update(text).digest('hex');
          const filename = `${Date.now()}_${textHash}.mp3`;

          const { bucket } = require('./config/storage');
          const filePath = bookId ? `books/${bookId}/audio/${filename}` : `audio/${filename}`;

          let audioUrl;
          if (bucket && process.env.GCS_BUCKET_NAME) {
            const blob = bucket.file(filePath);
            await new Promise((resolve, reject) => {
              const blobStream = blob.createWriteStream({
                metadata: { contentType: 'audio/mpeg' }
              });
              blobStream.on('error', reject);
              blobStream.on('finish', () => {
                audioUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                resolve();
              });
              blobStream.end(fullAudio);
            });
          } else {
            // Local storage fallback
            const fs = require('fs');
            const uploadsDir = path.join(__dirname, '../../uploads');
            const localPath = path.join(uploadsDir, filePath);
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(localPath, fullAudio);
            audioUrl = `/uploads/${filePath}`;
          }

          // Generate estimated alignment if we don't have it
          if (wordAlignment.length === 0) {
            console.log('⚠️ No alignment from ElevenLabs, generating estimated alignment');
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const estimatedDurationPerWord = 0.4; // seconds per word (average)

            wordAlignment = words.map((word, index) => {
              const startTime = index * estimatedDurationPerWord;
              const endTime = (index + 1) * estimatedDurationPerWord;
              return {
                word: word,
                start: startTime,
                end: endTime
              };
            });
            console.log('✅ Generated estimated alignment:', wordAlignment.length, 'words');
          }

          // Cache the result
          const TTSCache = require('./models/TTSCache');

          // Use wordAlignment if we have it, otherwise create empty
          const finalWordAlignment = wordAlignment.length > 0 ? wordAlignment : [];
          console.log('💾 Final word alignment for cache:', finalWordAlignment.length, 'words');

          await TTSCache.findOneAndUpdate(
            { textHash, voiceId },
            {
              textHash,
              voiceId,
              text,
              audioUrl,
              alignmentData: { words: finalWordAlignment }
            },
            { upsert: true, new: true }
          );

          // Send final audio URL
          ws.send(JSON.stringify({
            type: 'complete',
            audioUrl: audioUrl,
            alignment: { words: finalWordAlignment }
          }));
        }

        ws.close();
      });

      ws.on('close', () => {
        console.log('Client WebSocket closed');
        if (elevenLabsWs.readyState === require('ws').OPEN) {
          elevenLabsWs.close();
        }
      });

    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ error: error.message }));
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/api/tts/ws`);
});
