// src/services/imageUploadService.js
//
// A photo captured on-device (via expo-image-picker) only exists as a
// local file:// path on THAT device — no other phone can resolve it.
// This uploads the photo to Firebase Storage and returns a public HTTPS
// URL that works from any device, which is what should actually get
// stored in Firestore instead of the raw local URI.

import {
  ref, uploadBytes, getDownloadURL,
} from 'firebase/storage';
import { storage } from '../config/firebase';

/**
 * @param {string} localUri - a file:// URI from ImagePicker's result.assets[0].uri
 * @param {string} folder - storage folder to organize uploads under, e.g. a merchant's uid
 * @returns {Promise<string>} the public download URL
 */
export async function uploadDealImage(localUri, folder) {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const filename = `${Date.now()}.jpg`;
  const storageRef = ref(storage, `deal-images/${folder}/${filename}`);

  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}
