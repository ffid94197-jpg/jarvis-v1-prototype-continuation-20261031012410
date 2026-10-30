# Publicly documented test media used in the JARVIS face/voice tests

- `nasa_astronaut_public_domain.jpg`: scikit-image `data.astronaut()`; NASA astronaut photograph; public-domain per scikit-image docs: https://scikit-image.org/docs/stable/api/skimage.data. Only face presence/detection testing, not use as a real enrolled user.
- `chelsea_cat_sample.jpg`: scikit-image `data.chelsea()` test image; package test asset. Negative *human face* example.
- `gradio_test_audio.wav`: open-source Gradio `test_data/test_audio.wav` from the installed Gradio package; input WAV/format testing only. No speech recognition accuracy claims; package authors/license at https://github.com/gradio-app/gradio.

These test assets are **never** sent to a network service by the verification harness. When using a real person's face for enrollment, obtain their consent; never repurpose public images for identifying strangers or authentication.
