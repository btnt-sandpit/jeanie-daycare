import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBCYwIF60LXQgRDfia9CHP5IsRnDsZ_hEM",
  authDomain: "jeanie-daycare.firebaseapp.com",
  projectId: "jeanie-daycare",
  storageBucket: "jeanie-daycare.firebasestorage.app",
  messagingSenderId: "214391068004",
  appId: "1:214391068004:web:7d6fd748cccbfb0d05d671"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);