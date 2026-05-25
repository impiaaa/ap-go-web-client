import wave, glob
import numpy

def gettypemax(dt):
    return (1<<((dt.itemsize*8)-1))-1

def writewave(fname, a, framerate):
    print("writing", fname)
    with wave.open(fname, 'w') as w:
        w.setnchannels(a.shape[1])
        w.setsampwidth(4)
        w.setframerate(framerate)
        w.setnframes(a.shape[0])
        w.writeframes((a * gettypemax(numpy.int32())).astype(numpy.int32).tobytes())

suffix = "-64.wav"

clips = []

for fname in glob.glob("*" + suffix):
    # read in
    try:
        wavin = wave.open(fname)
    except wave.Error as e:
        print(e)
        continue
    a = numpy.frombuffer(wavin.readframes(wavin.getnframes()), [None, numpy.int8, numpy.int16, None, numpy.int32, None, None, None, numpy.int64][wavin.getsampwidth()])
    params = wavin.getparams()
    wavin.close()

    a = a.reshape((a.shape[0]//params.nchannels, params.nchannels))
    a = a.astype(float)/gettypemax(a.dtype)
    peak = numpy.max(numpy.abs(a))
    rms = numpy.sqrt(numpy.mean(numpy.square(a)))
    print(fname, peak, rms)
    clips.append((fname, a, params, peak, rms))

normalized_rms = [rms/peak for fname, a, params, peak, rms in clips]
print("normalized_rms", normalized_rms)
quietest_normalized = min(normalized_rms)
print("quietest_normalized", quietest_normalized)
target_rms = quietest_normalized

for (fname, a, params, peak, rms) in clips:
    amplification = target_rms / rms
    print("to amplify", rms, "to", target_rms, "multiply by", amplification)
    amplified = a * amplification
    a = amplified

    if a.shape[1] > 1 and numpy.all((numpy.max(a, axis=1) - numpy.min(a, axis=1)) < 1/256):
        print("mono")
        a = numpy.expand_dims(numpy.mean(a, axis=1))

    trim_indices, = numpy.nonzero(numpy.all(numpy.abs(a) >= 1/256, axis=1))
    print("trim from", trim_indices[0], "to", trim_indices[-1] + 1)
    a = a[trim_indices[0]:(trim_indices[-1] + 1), :]

    writewave(fname.removesuffix(suffix) + "-trim.wav", a, params.framerate)

