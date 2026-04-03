/**
 * Firebase Web config (public keys — security is enforced with Firestore rules).
 *
 * 1. Firebase console → Project → Project settings → Your apps → Web app → copy config.
 * 2. Authentication → Sign-in method → enable Anonymous.
 * 3. Firestore Database → Create database → test mode OK for prototyping, then replace rules
 *    with something like firestore.rules.example in this repo.
 *
 * Project: Wizards Of Whimsy (testchat-b1381).
 */
window.CardMakerFirebaseConfig = {
    apiKey: 'AIzaSyAJ93VzjlVzooyetlrmETqqJQuRTU-Afmk',
    authDomain: 'testchat-b1381.firebaseapp.com',
    projectId: 'testchat-b1381',
    storageBucket: 'testchat-b1381.firebasestorage.app',
    messagingSenderId: '1059273118763',
    appId: '1:1059273118763:web:1b557682a762b013e4866e'
};
