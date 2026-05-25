const gravity = 256;
const rotate_speed = 4;
const particle_count = 32;

const canvas = document.getElementById("particle-overlay") as HTMLCanvasElement;
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;
const observer = new ResizeObserver(() => {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
});
observer.observe(canvas);
const context = canvas.getContext("2d");
if (!context) {
  console.error("Can't initialize 2D context");
}

class Particle {
  readonly position_x: number;
  readonly position_y: number;
  readonly velocity_x: number;
  readonly velocity_y: number;
  readonly rotation_pitch: number;
  readonly rotation_yaw: number;
  readonly color: string;
  constructor(
    position_x: number,
    position_y: number,
    velocity_x: number,
    velocity_y: number,
    rotation_pitch: number,
    rotation_yaw: number,
    color: string,
  ) {
    this.position_x = position_x;
    this.position_y = position_y;
    this.velocity_x = velocity_x;
    this.velocity_y = velocity_y;
    this.rotation_pitch = rotation_pitch;
    this.rotation_yaw = rotation_yaw;
    this.color = color;
  }
}

const particles: Particle[] = [];
let start_time: DOMHighResTimeStamp = 0;

export function start() {
  const initial_max_velocity = Math.min(canvas.width, canvas.height);
  particles.splice(0);
  for (let i = 0; i < particle_count / 2; i++) {
    particles.push(
      new Particle(
        0,
        canvas.height * 0.5,
        Math.random() * initial_max_velocity,
        Math.random() * -initial_max_velocity,
        Math.random() * 2 * Math.PI,
        Math.random() * 2 * Math.PI,
        `hsl(${Math.random() * 360}, 100%, 50%)`,
      ),
    );
  }
  for (let i = 0; i < particle_count / 2; i++) {
    particles.push(
      new Particle(
        canvas.width,
        canvas.height * 0.5,
        Math.random() * -initial_max_velocity,
        Math.random() * -initial_max_velocity,
        Math.random() * 2 * Math.PI,
        Math.random() * 2 * Math.PI,
        `hsl(${Math.random() * 360}, 100%, 50%)`,
      ),
    );
  }
  canvas.style.visibility = "visible";
  start_time = performance.now();
  window.requestAnimationFrame(animate);
}

function animate(timestamp: DOMHighResTimeStamp) {
  if (!context) {
    return;
  }
  const drag = canvas.width / 3;
  const elapsed = (timestamp - start_time) / 1000;
  context.clearRect(0, 0, canvas.width, canvas.height);
  let done = true;
  particles.forEach((p) => {
    const x =
      p.position_x +
      p.velocity_x * elapsed -
      (Math.sign(p.velocity_x) * drag * elapsed * elapsed) / 2;
    const y =
      p.position_y + p.velocity_y * elapsed + (gravity * elapsed * elapsed) / 2;
    context.translate(x, y);
    context.scale(
      1,
      Math.sin(p.rotation_pitch + elapsed * Math.PI * rotate_speed),
    );
    context.rotate(p.rotation_yaw);
    context.fillStyle = p.color;
    context.fillRect(-8, -8, 16, 16);
    context.resetTransform();
    done = done && (x < 0 || x > canvas.width || y > canvas.height);
  });
  if (done) {
    canvas.style.visibility = "hidden";
  } else {
    window.requestAnimationFrame(animate);
  }
}
