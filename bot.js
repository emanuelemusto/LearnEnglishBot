const TelegramBot = require('node-telegram-bot-api');
const { Connection, Request } = require("tedious");
const { SpeechConfig, AudioConfig, SpeechRecognizer, SpeechSynthesizer } = require('microsoft-cognitiveservices-speech-sdk');
const stream = require('stream');
const axios = require('axios');
const path = require('path');
const os = require('os');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);


// Replace 'YOUR_BOT_TOKEN' with your Telegram Bot token
const bot = new TelegramBot('', { polling: true });

// Azure SQL Database configuration
const config = {
  authentication: {
    options: {
      userName: "",
      password: ""
    },
    type: "default"
  },
  server: "",
  options: {
    database: "",
    encrypt: true
  }
};

const connection = new Connection(config);

// Azure Speech Services configuration
const subscriptionKey = 'e39c5b2154aa487eb3a6c3019fec8431';
const serviceRegion = 'westeurope';

// Quiz state
let quizState = {};
let dbConnection = null;

// Function to establish database connection
function connectToDatabase() {
  return new Promise((resolve, reject) => {
    connection.on("connect", err => {
      if (err) {
        console.error("Error connecting to database:", err.message);
        reject(err);
      } else {
        console.log("Connected to the database");
        dbConnection = connection;
        resolve(connection);
      }
    });
    connection.connect();
  });
}

// Function to query the database
function queryDatabase() {
  return new Promise((resolve, reject) => {
    connection.on("connect", err => {
      if (err) {
        console.error(err.message);
      } else {
        queryDatabase();
      }
    });

    const phrases = [];
    const request = new Request(
      `SELECT top 10 * FROM [dbo].[frasi] ORDER BY newId()`,
      (err, rowCount) => {
        if (err) {
          reject(err);
        } else {
          resolve(phrases);
        }
      }
    );

    request.on("row", columns => {
      columns.forEach(column => {
        phrases.push(column.value);
      });
    });

    dbConnection.execSql(request);
  });
}

// Helper function to convert a Buffer to a ReadableStream
function bufferToStream(buffer) {
  const stream = new stream.Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

// Start the quiz
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const phrases = await queryDatabase();
    quizState[chatId] = {
      score: 0,
      questionCounter: 0,
      currentQuestion: null,
      phrases: phrases
    };
    sendNextQuestion(chatId);
  } catch (error) {
    console.error("Error starting quiz:", error);
    bot.sendMessage(chatId, "Scusa non ho potuto iniziare il test riprova più tardi.");
  }
});

// Send next question
function sendNextQuestion(chatId) {
  const state = quizState[chatId];
  if (state?.questionCounter >= 10 || state?.phrases.length === 0) {
    bot.sendMessage(chatId, `Quiz completato! punteggio finale ${state.score} / 4000`);
    delete quizState[chatId];
  } else {
  if (state == undefined) {
    return;
  }
    state.questionCounter++;
    state.currentQuestion = state.phrases.pop();
    bot.sendMessage(chatId, `Frase n° ${state.questionCounter}/10: ${state.currentQuestion}`);
  }
}

// Handle user's answer
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const voiceFileId = msg.voice.file_id;
  const token = '8024182389:AAEO5DyjKl8gwsEMvXn5Cjv7SjXpgwsSlV4';

  try {
    // Scarica il file audio
    const fileInfo = await bot.getFile(voiceFileId);
    const voiceFileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    const response = await axios({
      method: 'GET',
      url: voiceFileUrl,
      responseType: 'arraybuffer'
    });

    // Salva il file audio temporaneamente
    const tempFilePath = `./temp_${voiceFileId}.wav`;
    fs.writeFileSync(tempFilePath, response.data);
    console.log('saved as file ' + tempFilePath);

    // Salva il file audio temporaneamente
    const tempOggPath = `./temp_${voiceFileId}.ogg`;
    fs.writeFileSync(tempOggPath, response.data);

    // Converti da .ogg a .wav
    const tempWavPath = `./temp_${voiceFileId}.wav`;
    await new Promise((resolve, reject) => {
      ffmpeg(tempOggPath)
        .toFormat('wav')
        .on('error', (err) => {
          console.log('An error occurred: ' + err.message);
          reject(err);
        })
        .on('end', () => {
          console.log('Processing finished !');
          resolve();
        })
        .save(tempWavPath);
    });

    // Configurazione del riconoscimento vocale
    const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion);
    speechConfig.speechRecognitionLanguage = "en-US";

    const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(tempWavPath));
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    // Configurazione della valutazione della pronuncia
    const state = quizState[chatId];
    const pronunciationAssessmentConfig = new sdk.PronunciationAssessmentConfig(
      state.currentQuestion,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true
    );

    pronunciationAssessmentConfig.applyTo(recognizer);

    let score = 0;

    recognizer.recognizeOnceAsync(
      async (result) => {
        const parsedJSON = JSON.parse(result.json);
        if (parsedJSON.Offset != 0) {
          
        score = Math.floor(
          parsedJSON.NBest[0].PronunciationAssessment.AccuracyScore +
          parsedJSON.NBest[0].PronunciationAssessment.FluencyScore +
          parsedJSON.NBest[0].PronunciationAssessment.CompletenessScore +
          parsedJSON.NBest[0].PronunciationAssessment.PronScore
        );

        const message = `Risultati:
        Confidenza: ${parsedJSON.NBest[0].Confidence}
        Accuratezza: ${parsedJSON.NBest[0].PronunciationAssessment.AccuracyScore}
        Scioltezza: ${parsedJSON.NBest[0].PronunciationAssessment.FluencyScore}
        Completezza: ${parsedJSON.NBest[0].PronunciationAssessment.CompletenessScore}
        Pronuncia: ${parsedJSON.NBest[0].PronunciationAssessment.PronScore}
        Punteggio totale: ${score}`;

        await bot.sendMessage(chatId, message);
        } else {
          await bot.sendMessage(chatId, 'Impossibile comprendere audio');
          score = 0;
        }

        const state = quizState[chatId];
        state.score += score;
        bot.sendMessage(chatId, `Punteggio per questa domanda: ${score}`);
        sendNextQuestion(chatId);

        // Pulizia
        recognizer.close();
        fs.unlinkSync(tempFilePath);
      },
      (err) => {
        console.log(err);
        bot.sendMessage(chatId, "Si è verificato un errore durante l'elaborazione del messaggio vocale.");
        fs.unlinkSync(tempFilePath);
      }
    );
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Si è verificato un errore durante l'elaborazione del messaggio vocale.");
  }
});

bot.onText(/\/next/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Saltiamo questa domanda');
  sendNextQuestion(chatId);
});

// Pronunciation suggestion
bot.onText(/\/pronounce/, async (msg) => {
  const chatId = msg.chat.id;
  const state = quizState[chatId];
  if (state && state.currentQuestion) {
    try {
      const message = 'Attempting to generate pronunciation for: ' +  state.currentQuestion; 
      console.log(message);
      bot.sendMessage(chatId, message);

      const tempFilePath = `pronunciation_${Date.now()}.wav`;

      new Promise((resolve, reject) => {
        const speechConfig = SpeechConfig.fromSubscription(subscriptionKey, serviceRegion);
        const audioConfig = AudioConfig.fromAudioFileOutput(tempFilePath);
        const synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

        synthesizer.speakTextAsync(
          state.currentQuestion,
          async result => {
            setTimeout(function() {
              console.log('This printed after about 5 second');
                console.log("Speech synthesis completed. Audio saved to:", tempFilePath);
                resolve(tempFilePath);
                    
                console.log("Audio file generated. Sending to user...");
                bot.sendDocument(chatId, tempFilePath);
                console.log("Audio sent successfully");
            }, 5000);
            console.log("pippo" + tempFilePath + "  " + result.reason);
            if (result.reason === "10") {
              console.log("Speech synthesis completed. Audio saved to:", tempFilePath);
              resolve(tempFilePath);
                  
              console.log("Audio file generated. Sending to user...");
              bot.sendDocument(chatId, tempFilePath);
              console.log("Audio sent successfully");
            } else {
              console.error("Speech synthesis failed:", result.errorDetails);
              resolve(null);
            }
            synthesizer.close();
          },
          error => {
            console.error("Error from Azure Speech Services:", error);
            resolve(null);
            synthesizer.close();
          }
        );
      });
      
      console.log("Pluto 2 " + tempFilePath);

      if (tempFilePath) {
        //
      } else {
        console.log("No audio file generated from Azure. Trying fallback TTS...");
        const fallbackAudioFilePath = await generateFallbackAudio(state.currentQuestion);
        if (fallbackAudioFilePath) {
          console.log("Fallback audio generated. Sending to user...");
          await bot.sendVoice(chatId, fallbackAudioFilePath);
          console.log("Fallback audio sent successfully");
          // Clean up the temporary file
          await fs.unlink(fallbackAudioFilePath);
        } else {
          throw new Error("Fallback TTS also failed");
        }
      }
    } catch (err) {
      console.error("Error in pronunciation feature:", err);
      bot.sendMessage(chatId, "Scusa non sono riuscito a generare il suggerimento per questa frase: " + state.currentQuestion);
    }
  } else {
    bot.sendMessage(chatId, "Nessun test attivo avvialo con il comando /start");
  }
});

// Gestisce il comando /translate
bot.onText(/\/translate/, async (msg) => {
  const chatId = msg.chat.id;
  const state = quizState[chatId];
  if (state == undefined) {
    return null;
  }
  const question = state.currentQuestion;
  try {
      // Invia messaggio di attesa
      bot.sendMessage(chatId, 'Sto traducendo...')
      .then(waitMessage => {
        // Inizia la traduzione con timeout
        translateText(question)
            .then(translatedText => {
                // Aggiorna il messaggio con la traduzione
                bot.editMessageText(
                    `🔄 Testo originale: ${question}\n` +
                    `🎯 Traduzione (IT): ${translatedText}`,
                    {
                        chat_id: chatId,
                        message_id: waitMessage.message_id
                    }
                );
            })
            .catch(error => {
                bot.sendMessage(chatId, '❌ Mi dispiace, c\'è stato un errore durante la traduzione.');
                console.error(error);
            });
    });
  } catch (error) {
      bot.sendMessage(chatId, '❌ Mi dispiace, c\'è stato un errore durante la traduzione.');
      console.error(error);
  }
});

const endpoint = 'https://api.cognitive.microsofttranslator.com';

async function translateText(text, targetLanguage = 'it', sourceLanguage = 'en') {
  try {
      const response = await axios({
          baseURL: endpoint,
          url: 'translate',
          method: 'POST',
          headers: {
              'Ocp-Apim-Subscription-Key': '5d4f03c8aa614cd5a6e4884ce2026099',
              'Ocp-Apim-Subscription-Region': 'italynorth',
              'Content-type': 'application/json',
          },
          params: {
              'api-version': '3.0',
              'from': sourceLanguage,
              'to': targetLanguage
          },
          data: [{
              'text': text
          }],
          json: true,
      });
      return response.data[0].translations[0].text;
  } catch (error) {
      console.error('Errore durante la traduzione:', error);
      throw error;
  }
}

// Function to generate fallback audio using a free TTS API
async function generateFallbackAudio(text) {
  const tempFilePath = path.join(os.tmpdir(), `fallback_pronunciation_${Date.now()}.mp3`);
  try {
    const response = await axios.get(`http://api.voicerss.org/?key=YOUR_VOICERSS_API_KEY&hl=en-us&src=${encodeURIComponent(text)}`, {
      responseType: 'arraybuffer'
    });
    await fs.writeFile(tempFilePath, Buffer.from(response.data));
    return tempFilePath;
  } catch (error) {
    console.error("Error with fallback TTS:", error);
    return null;
  }
}

// Initialize the bot
async function initBot() {
  try {
    await connectToDatabase();
    console.log('Bot is running...');
  } catch (error) {
    console.error("Failed to initialize the bot:", error);
    process.exit(1);
  }
}

initBot();
