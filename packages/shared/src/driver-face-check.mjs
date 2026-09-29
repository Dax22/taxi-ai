export const DRIVER_FACE_CONSENT_VERSION = 'driver-face-match-v1';
export const DRIVER_FACE_CONSENT = 'I agree to Taxi AI sending my saved driver photo and licence image to Amazon Rekognition to compare their faces.';

/** Face similarity is separate from licence validity, liveness and driver approval. */
export function driverFaceCheckComplete(check) {
  return !check?.available || (['matched', 'needs_review', 'unavailable'].includes(check.status) && check.checkedAt != null);
}

export function driverFacePresentation(check) {
  if (!check || (!check.available && check.status === 'not_started')) return {
    title: 'Face comparison unavailable', detail: 'You can continue with document review.',
  };
  if (check.status === 'matched') return { title: 'Face comparison passed',
    detail: 'Your photos meet the face-similarity threshold. Your application still needs document review.' };
  if (check.status === 'pending') return { title: 'Comparing your photos…',
    detail: 'Please wait. You do not need to send another request.' };
  if (check.status === 'unavailable') return { title: 'Comparison could not finish',
    detail: 'Try again later, or submit your documents for staff review. No face match has been confirmed.' };
  if (check.status === 'needs_review') {
    const reasons = {
      invalid_image: 'Use clear, readable photos of your face and the front of your licence.',
      no_face: 'A face could not be found clearly in both photos. Retake the unclear photo.',
      multiple_faces: 'More than one face was detected. Staff can review the photos, or you can replace an incorrect image.',
      low_confidence: 'Your face could not be read clearly. Use good lighting and keep your face uncovered.',
      below_threshold: 'The photos did not meet the face-similarity threshold. This does not automatically reject your application.',
    };
    return { title: 'Staff review needed', detail: reasons[check.reason] ?? 'We could not confidently match these photos. Staff can review your application.' };
  }
  return { title: 'Compare your face', detail: 'Save a clear selfie and the front of your licence, then run the automatic comparison.' };
}
