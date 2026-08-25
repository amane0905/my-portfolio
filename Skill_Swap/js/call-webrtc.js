"use strict";
// ===== 音声・映像通話（WebRTC + Firestoreシグナリング） =====
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let pc = null;
let localStream = null;
let currentCallConvId = null;
let currentCallRole = null;
let unsubCallDoc = null;
let unsubRemoteCandidates = null;

function callDocRef(convId) {
  return fireDb.collection("calls").doc(convId);
}

function candidatesCollection(convId, who) {
  return callDocRef(convId).collection(who + "Candidates");
}

function resetCallState() {
  if (unsubCallDoc) { unsubCallDoc(); unsubCallDoc = null; }
  if (unsubRemoteCandidates) { unsubRemoteCandidates(); unsubRemoteCandidates = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  currentCallConvId = null;
  currentCallRole = null;
}

function makePeerConnection(convId, role, onRemoteStream) {
  const conn = new RTCPeerConnection(ICE_SERVERS);
  const myCandidateCollection = candidatesCollection(convId, role);

  conn.onicecandidate = (event) => {
    if (event.candidate) {
      myCandidateCollection.add(event.candidate.toJSON());
    }
  };

  conn.ontrack = (event) => {
    onRemoteStream(event.streams[0]);
  };

  return conn;
}

async function startOutgoingCall(convId, myId, peerId, type, onRemoteStream, onRemoteEnded) {
  resetCallState();
  currentCallConvId = convId;
  currentCallRole = "caller";

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: type === "video",
  });

  pc = makePeerConnection(convId, "caller", onRemoteStream);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await callDocRef(convId).set({
    callerId: myId,
    calleeId: peerId,
    type,
    status: "ringing",
    offer: { type: offer.type, sdp: offer.sdp },
    answer: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  unsubCallDoc = callDocRef(convId).onSnapshot(async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    if (data.status === "ended") {
        if (onRemoteEnded) onRemoteEnded();
        endCall();
    }
  });

unsubRemoteCandidates =
  candidatesCollection(convId, "callee")
    .onSnapshot((snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        if (!pc) return;
        if (pc.signalingState === "closed") return;
        if (!pc.remoteDescription) return;
        try {
          const data = change.doc.data();
          await pc.addIceCandidate(
            new RTCIceCandidate(data)
          );
        } catch (error) {
          console.warn(
            "ICE candidate の追加をスキップしました:",
            error
          );
        }
      });
    });
  return localStream;
}

function listenForIncomingCalls(myId, onIncomingCall) {
  return fireDb
    .collection("calls")
    .where("calleeId", "==", myId)
    .where("status", "==", "ringing")
    .onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const d = change.doc.data();
          onIncomingCall({ convId: change.doc.id, callerId: d.callerId, type: d.type });
        }
      });
    });
}

async function acceptIncomingCall(convId, type, onRemoteStream, onRemoteEnded) {
  resetCallState();
  currentCallConvId = convId;
  currentCallRole = "callee";

  const snap = await callDocRef(convId).get();
  const data = snap.data();
  if (!data || !data.offer) throw new Error("通話情報が見つかりません");

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: type === "video",
  });

  pc = makePeerConnection(convId, "callee", onRemoteStream);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await callDocRef(convId).set(
    { answer: { type: answer.type, sdp: answer.sdp }, status: "accepted" },
    { merge: true }
  );

unsubRemoteCandidates =
  candidatesCollection(convId, "caller")
    .onSnapshot((snap2) => {
      snap2.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        if (!pc) return;
        if (pc.signalingState === "closed") return;
        if (!pc.remoteDescription) return;
        try {
          const data = change.doc.data();
          await pc.addIceCandidate(
            new RTCIceCandidate(data)
          );
        } catch (error) {
          console.warn(
            "ICE candidate の追加をスキップしました:",
            error
          );
        }
      });
    });

  unsubCallDoc = callDocRef(convId).onSnapshot((snap3) => {
    const d = snap3.data();
    if (d && d.status === "ended") {
        if (onRemoteEnded) onRemoteEnded();
    }
  });

  return localStream;
}

async function declineIncomingCall(convId) {
  await callDocRef(convId).set({ status: "ended" }, { merge: true });
}

function toggleMute() {
  if (!localStream) return false;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return false;
  audioTrack.enabled = !audioTrack.enabled;
  return !audioTrack.enabled;
}

async function endCall() {
  const convId = currentCallConvId;
  if (convId) {
    try {
      await callDocRef(convId).set({ status: "ended" }, { merge: true });
    } catch (e) { /* 既に削除済みなどは無視 */ }
  }
  resetCallState();
}