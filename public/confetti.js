(function() {
    const canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let pieces = [];
    const numberOfPieces = 150;
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722'];

    function update() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        pieces.forEach((p, i) => {
            p.y += p.speed;
            p.rotation += p.rotationSpeed;
            if (p.y > canvas.height) pieces[i] = createPiece();
        });
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            ctx.save();
            ctx.fillStyle = p.color;
            ctx.translate(p.x + p.size / 2, p.y + p.size / 2);
            ctx.rotate(p.rotation);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
        });
        requestAnimationFrame(() => {
            update();
            draw();
        });
    }

    function createPiece() {
        return {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            size: Math.random() * 10 + 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            speed: Math.random() * 3 + 2,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: Math.random() * 0.1 - 0.05
        };
    }

    window.triggerConfetti = function() {
        pieces = [];
        for (let i = 0; i < numberOfPieces; i++) pieces.push(createPiece());
        canvas.classList.remove('hidden');
        setTimeout(() => {
            pieces = [];
            canvas.classList.add('hidden');
        }, 3000);
    };

    draw();
})();
