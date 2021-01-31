function randomEmoji() {
    const possibleEmojis = [
        '🐀', '🐁', '🐭', '🐹', '🐂', '🐃', '🐄', '🐮', '🐅', '🐆', '🐯', '🐇', '🐐', '🐑', '🐏', '🐴',
        '🐎', '🐱', '🐈', '🐰', '🐓', '🐔', '🐤', '🐣', '🐥', '🐦', '🐧', '🐘', '🐩', '🐕', '🐷', '🐖',
        '🐗', '🐫', '🐪', '🐶', '🐺', '🐻', '🐨', '🐼', '🐵', '🙈', '🙉', '🙊', '🐒', '🐉', '🐲', '🐊',
        '🐍', '🐢', '🐸', '🐋', '🐳', '🐬', '🐙', '🐟', '🐠', '🐡', '🐚', '🐌', '🐛', '🐜', '🐝', '🐞',
    ];

    const randomIndex = Math.floor(Math.random() * possibleEmojis.length);
    return possibleEmojis[randomIndex];
}
const emoji = randomEmoji();
const name = ''; //prompt("What's your name?");

// Generate random room name if needed
if (!location.hash) {
    location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
}
const roomHash = location.hash.substring(1);

const drone = new ScaleDrone('yiS12Ts5RdNhebyM');
// Room name needs to be prefixed with 'observable-'
const roomName = 'observable-' + roomHash;
const configuration = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302' // Google's public STUN server
    }]
};
let room;
// RTCPeerConnection
let pc;
// RTCDataChannel
let dataChannel;
let isSharingScreen = false;

function onSuccess() {
}
function onError(error) {
    console.error(error);
}

drone.on('open', error => {
    if (error) {
        return onError(error);
    }

    room = drone.subscribe(roomName);
    room.on('open', error => {
        if (error) {
            onError(error);
        }
    });
    // We're connected to the room and received an array of 'members'
    // connected to the room (including us). Signaling server is ready
    room.on('members', members => {
        console.log('MEMBERS', members);
        // If we are the second user to connect to the room we will be creating the offer
        const isOfferer = members.length === 2;
        startWebRTC(isOfferer);
    });
});

// Send signaling data via Scaledrone
function sendMessage(message) {
    drone.publish({
        room: roomName,
        message
    });
}

function startWebRTC(isOfferer) {
    pc = new RTCPeerConnection(configuration);

    // 'onicecandidate' notifies us whenever an ICE agent needs to deliver a
    // message to the other peer through the signaling server
    pc.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ 'candidate': event.candidate });
        }
    };

    // If user is offerer let the 'negotiationneeded' event create the offer
    if (isOfferer) {
        pc.onnegotiationneeded = () => {
            pc.createOffer().then(localDescCreated).catch(onError);
        }

        dataChannel = pc.createDataChannel('chat');
        setupDataChannel();
    } else {
        // If user is not the offerer let's wait for a data channel
        pc.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel();
        }
    }

    // When a remote stream arrives display it in the #remoteVideo element
    pc.ontrack = event => {
        const stream = event.streams[0];
        if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== stream.id) {
            remoteVideo.srcObject = stream;
        }
    };

    shareWebCam();

    // Listen to signaling data from Scaledrone
    room.on('data', (message, client) => {
        // Message was sent by us
        if (client.id === drone.clientId) {
            return;
        }

        if (message.sdp) {
            // This is called after receiving an offer or answer from another peer
            pc.setRemoteDescription(new RTCSessionDescription(message.sdp), () => {
                // When receiving an offer lets answer it
                if (pc.remoteDescription.type === 'offer') {
                    pc.createAnswer().then(localDescCreated).catch(onError);
                }
            }, onError);
        } else if (message.candidate) {
            // Add the new ICE candidate to our connections remote description
            pc.addIceCandidate(
                new RTCIceCandidate(message.candidate), onSuccess, onError
            );
        }
    });
}

function localDescCreated(desc) {
    pc.setLocalDescription(
        desc,
        () => sendMessage({ 'sdp': pc.localDescription }),
        onError
    );
}

// Hook up data channel event handlers
function setupDataChannel() {
    function checkDataChannelState() {
        console.log('WebRTC channel state is:', dataChannel.readyState);
        if (dataChannel.readyState === 'open') {
            insertMessageToDOM({ content: 'WebRTC data channel is now open' });
        }
    }

    checkDataChannelState();
    dataChannel.onopen = checkDataChannelState;
    dataChannel.onclose = checkDataChannelState;
    dataChannel.onmessage = event =>
        insertMessageToDOM(JSON.parse(event.data), false)
}

function insertMessageToDOM(options, isFromMe) {
    const template = document.querySelector('template[data-template="message"]');
    const nameEl = template.content.querySelector('.message__name');
    if (options.emoji || options.name) {
        nameEl.innerText = options.emoji + ' ' + options.name;
    }
    template.content.querySelector('.message__bubble').innerText = options.content;
    const clone = document.importNode(template.content, true);
    const messageEl = clone.querySelector('.message');
    if (isFromMe) {
        messageEl.classList.add('message--mine');
    } else {
        messageEl.classList.add('message--theirs');
    }

    const messagesEl = document.querySelector('.messages');
    messagesEl.appendChild(clone);

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight - messagesEl.clientHeight;
}

function shareWebCam() {
    navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
    }).then(stream => {
        // Display your local video in #localVideo element
        localVideo.srcObject = stream;

        // Add your stream to be sent to the conneting peer
        // We already have senders and trackes registered, need only to replace the video track
        if (pc.getSenders().length) {
            const videoTrack = stream.getVideoTracks()[0];
            const sender = pc.getSenders().find(s => s.track.kind == videoTrack.kind);
            sender.replaceTrack(videoTrack);

            return;
        }

        // Else, we need to add new senders and tracks
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }, onError);
}

function shareScreen() {
    navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true
    }).then(stream => {
        // Display your local video in #localVideo element
        localVideo.srcObject = stream;

        // Add your stream to be sent to the conneting peer
        const videoTrack = stream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track.kind == videoTrack.kind);
        sender.replaceTrack(videoTrack);
    }, onError);
}

const form = document.querySelector('form');
form.addEventListener('submit', () => {
    const input = document.querySelector('input[type="text"]');
    const value = input.value;
    input.value = '';

    const data = {
        name,
        content: value,
        emoji,
    };

    dataChannel.send(JSON.stringify(data));

    insertMessageToDOM(data, true);
});

const shareButton = document.getElementById('shareButton');
shareButton.addEventListener('click', () => {
    if (isSharingScreen) {
        shareWebCam();
        shareButton.innerHTML = "Share your screen";
        isSharingScreen = false;

        return;
    }

    shareScreen();
    shareButton.innerHTML = "Share your webcam";
    isSharingScreen = true;
});

insertMessageToDOM({ content: 'Chat URL is ' + location.href });