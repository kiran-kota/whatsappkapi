const fs = require('fs');
const { Client } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const http = require('http');
const bodyParser = require("body-parser");
const qrcode = require('qrcode-terminal');
const socketIO = require('socket.io');
const qr = require('qrcode');
const { phoneNumberFormatter } = require('./helpers/formatter');
const port = process.env.PORT || 8000;

const app = express();
var server = http.createServer(app);
var io = socketIO(server);

app.use(express.static(__dirname + '/'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.set('views', __dirname);
app.use(cors());


server.listen(port, function() {
    console.log('App running on *: ' + port);
});

var sessions = [];
const SESSIONS_FILE ='./whatsapp-sessions.json';

const setSessionsFile = function(sessions){
    console.log(sessions, 'sessions');
    fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err){
        if(err){
            console.log(err);
        }
    })
}

const getSessionsFile = function(){
    return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id){    
    const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
    let sessionData;
    if(fs.existsSync(SESSION_FILE_PATH)) {
        sessionData = require(SESSION_FILE_PATH);
    }

    const client = new Client({
        restartOnAuthFail: true,
        puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
            '--disable-gpu'
        ],
        },
        session: sessionData
    });
    

    client.on('qr', res => {
        //qrcode.generate(res, {small: true});
        qr.toDataURL(res, (err, url)=>{
            io.emit('qr', {id: id, url: url});
            io.emit('message', {id: id, text: 'QR Code received, scan please!'});
        })
    });

    client.on('ready', () => {
        console.log('Client is ready!');
        io.emit('ready', {id: id});
        io.emit('message', {id: id, text: 'Whatsapp is ready!'});
        var savedSessions = getSessionsFile();
        console.log(savedSessions, 'savedSessions');
        const sessionIndex = savedSessions.findIndex(x=>x.id == id);
        if(sessionIndex == -1){
            savedSessions.push({id:id});
            setSessionsFile(savedSessions);
        }
        sessions = sessions.filter(x=>x.id != id);
        sessions.push({id: id, client: client});
    });

    client.on('authenticated', (session) => {
        io.emit('authenticated', {id: id});
        io.emit('message', {id: id, text: 'Whatsapp is authenticated!'});
        sessionData = session;
        fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), (err) => {
            if (err) {
                console.error(err);
            }
        });
       
    });
    client.on('auth_failure', (session) => {
        io.emit('auth_failure', {id: id});
        io.emit('message', {id: id, text: 'Auth Failure'});
    });

    client.on('disconnected', (reason) => {
        io.emit('disconnected', {id: id});
        io.emit('message', {id: id, text: 'Whatsapp is disconnected'});
        // fs.unlinkSync(SESSION_FILE_PATH, (err) => {
        //     if (err) {
        //         console.error(err);
        //     }
        // });
        // sessions = sessions.filter(x=>x.id != id);
        // var savedSessions = getSessionsFile();
        // savedSessions = savedSessions.filter(x=>x.id != id);
        // setSessionsFile(savedSessions);
        client.destroy();
        client.initialize();
    });
    client.initialize();

}

io.on('connection', function(socket){
    socket.on('create-session', function(data){
        console.log(data, 'data');
        io.emit('message', {id: data.id, text: 'loading...'});
        createSession(data.id);
    })
})


const checkRegisteredNumber = async function(number, cl){
    const isRegistered = await cl.isRegisteredUser(number);
    return isRegistered;
}

app.get('/', (req, res)=>res.send('welcome'));

app.get('/session/:id', (req, res)=>{
    var id = req.params.id;
    res.render('session.html', {id: id});
});

app.post('/send-message', async (req, res)=>{
    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;
    const sender = req.body.sender;
    // const url = req.body.url

    try {
        const client = sessions.find(x=>x.id == sender).client;
        const isRegisteredNumber = await checkRegisteredNumber(number, client);
        if(!isRegisteredNumber){
            return res.status(200).json({status: false, message: 'The number is not registered'});
        }
       
        await client.sendMessage(number, message);
        // if(url != undefined){
        //     const media = await MessageMedia.fromUrl('https://via.placeholder.com/350x150.png');
        //     await client.sendMessage(number, media);
        // }
        return res.status(200).json({status: true, message: 'message sent successfully'});
    } catch (error) {
        console.log(error);
        return res.status(422).json(error);
    }
})

const init = function(){
    const savedSessions = getSessionsFile();
    if(savedSessions.length > 0){
        savedSessions.forEach((ele) => {
            createSession(ele.id);
        });
    }
}
init();