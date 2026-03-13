/**
 * ProTest System Core Logic
 * Handles Authentication, Data persistence, Exam Engine, and UI updates.
 */

const App = {
    // Standard application state
    state: {
        users: [],
        currentUser: null,
        exam: {
            questions: [],
            currentIndex: 0,
            timer: 7200, // 120 minutes in seconds
            intervalId: null,
            isPaused: false,
            answers: {} // tracks answered states: { [index]: { confirmed: boolean, selected: [], isCorrect: boolean } }
        }
    },

    // Initialization
    init() {
        this.loadUsers();
        this.bindEvents();
        this.checkSession();
    },

    loadUsers() {
        const stored = localStorage.getItem('protest_users');
        if (stored) {
            this.state.users = JSON.parse(stored);
        } else {
            // Default Admin setup
            this.state.users = [{
                username: 'admin',
                password: 'admin', // In production, never store plain-text passwords
                role: 'admin',
                expiry: '2099-12-31',
                history: []
            }];
            this.saveUsers();
        }
    },

    saveUsers() {
        localStorage.setItem('protest_users', JSON.stringify(this.state.users));
    },

    // View Routing
    switchView(viewId) {
        const views = ['view-login', 'view-admin', 'view-student', 'view-exam', 'view-result'];
        views.forEach(v => document.getElementById(v).classList.add('hidden'));
        document.getElementById(viewId).classList.remove('hidden');
        document.getElementById(viewId).classList.add('flex');
    },

    checkSession() {
        const activeUser = sessionStorage.getItem('protest_active_user');
        if (activeUser) {
            this.state.currentUser = JSON.parse(activeUser);
            this.updateHeader();
            if (this.state.currentUser.role === 'admin') this.renderAdminDashboard();
            else this.renderStudentDashboard();
        } else {
            this.switchView('view-login');
            document.getElementById('user-info').classList.add('hidden');
        }
    },

    updateHeader() {
        const ui = document.getElementById('user-info');
        const name = document.getElementById('logged-user-name');
        if (this.state.currentUser) {
            ui.classList.remove('hidden');
            name.textContent = `${this.state.currentUser.username} (${this.state.currentUser.role})`;
        } else {
            ui.classList.add('hidden');
        }
    },

    // Binding Global DOM Events
    bindEvents() {
        // Auth
        document.getElementById('login-form').addEventListener('submit', (e) => this.login(e));
        document.getElementById('btn-logout').addEventListener('click', () => this.logout());

        // Admin
        document.getElementById('create-user-form').addEventListener('submit', (e) => this.createUser(e));

        // Student / Exam
        document.getElementById('btn-start-exam').addEventListener('click', () => this.startExam());
        document.getElementById('btn-prev').addEventListener('click', () => this.navigateExam(-1));
        document.getElementById('btn-next').addEventListener('click', () => this.navigateExam(1));
        document.getElementById('btn-confirm').addEventListener('click', () => this.confirmAnswer());
        document.getElementById('btn-pause').addEventListener('click', () => this.togglePause(true));
        document.getElementById('btn-resume').addEventListener('click', () => this.togglePause(false));
        document.getElementById('btn-early-exit').addEventListener('click', () => {
            if (confirm("Are you sure you want to end the exam early?")) this.endExam();
        });
        document.getElementById('btn-return-dash').addEventListener('click', () => this.renderStudentDashboard());
    },

    // -------- AUTHENTICATION --------
    login(e) {
        e.preventDefault();
        const u = document.getElementById('login-user').value.trim();
        const p = document.getElementById('login-pass').value.trim();
        const err = document.getElementById('login-error');

        const user = this.state.users.find(x => x.username === u && x.password === p);

        if (!user) {
            err.classList.remove('hidden');
            return;
        }

        // Check Expiry Logic
        const today = new Date().setHours(0, 0, 0, 0);
        const expiry = new Date(user.expiry).setHours(0, 0, 0, 0);
        if (today > expiry) {
            err.textContent = "Account access has expired.";
            err.classList.remove('hidden');
            return;
        }

        err.classList.add('hidden');
        this.state.currentUser = user;
        sessionStorage.setItem('protest_active_user', JSON.stringify(user));
        this.updateHeader();

        if (user.role === 'admin') this.renderAdminDashboard();
        else this.renderStudentDashboard();
    },

    logout() {
        if(this.state.exam.intervalId) clearInterval(this.state.exam.intervalId);
        this.state.currentUser = null;
        sessionStorage.removeItem('protest_active_user');
        document.getElementById('login-form').reset();
        this.checkSession();
    },

    // -------- ADMIN LOGIC --------
    renderAdminDashboard() {
        this.switchView('view-admin');
        const list = document.getElementById('admin-user-list');
        list.innerHTML = '';

        const today = new Date().setHours(0, 0, 0, 0);

        this.state.users.forEach(user => {
            const expiryDate = new Date(user.expiry).setHours(0,0,0,0);
            const isExpired = today > expiryDate;
            const statusHtml = isExpired
                ? `<span class="px-2 py-1 bg-rose-900/40 text-rose-500 rounded text-xs">Expired</span>`
                : `<span class="px-2 py-1 bg-emerald-900/40 text-emerald-500 rounded text-xs">Active</span>`;

            list.innerHTML += `
                <tr class="hover:bg-slate-800/50 transition">
                    <td class="py-3 px-2">${user.username}</td>
                    <td class="py-3 px-2 capitalize text-slate-400">${user.role}</td>
                    <td class="py-3 px-2 text-slate-400">${user.expiry === '2099-12-31' ? 'Never' : user.expiry}</td>
                    <td class="py-3 px-2">${statusHtml}</td>
                </tr>
            `;
        });
    },

    createUser(e) {
        e.preventDefault();
        const u = document.getElementById('create-username').value.trim();
        const p = document.getElementById('create-password').value.trim();
        const ex = document.getElementById('create-expiry').value;

        if (this.state.users.some(x => x.username === u)) {
            alert('Username already exists!');
            return;
        }

        this.state.users.push({
            username: u, password: p, expiry: ex, role: 'student', history: []
        });

        this.saveUsers();
        document.getElementById('create-user-form').reset();
        this.renderAdminDashboard();
    },

    // -------- STUDENT LOGIC --------
    renderStudentDashboard() {
        this.switchView('view-student');
        const list = document.getElementById('student-history-list');
        list.innerHTML = '';

        // Fetch fresh user data from storage for history
        const freshUser = this.state.users.find(u => u.username === this.state.currentUser.username);

        if (!freshUser.history || freshUser.history.length === 0) {
            list.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-500 italic">No exams taken yet.</td></tr>`;
            return;
        }

        freshUser.history.reverse().forEach(h => {
            list.innerHTML += `
                <tr class="hover:bg-slate-800/50 transition">
                    <td class="py-3 px-2 text-slate-300">${h.date}</td>
                    <td class="py-3 px-2 text-slate-400">${h.time}</td>
                    <td class="py-3 px-2 text-white">${h.score} / ${h.total}</td>
                    <td class="py-3 px-2">
                        <span class="px-2 py-1 rounded text-xs ${h.percentage >= 70 ? 'bg-emerald-900/40 text-emerald-400' : 'bg-rose-900/40 text-rose-400'}">
                            ${h.percentage}%
                        </span>
                    </td>
                </tr>
            `;
        });
    },

    // -------- EXAMINATION ENGINE --------
    async startExam() {
        try {
            const response = await fetch('questions.json');
            if (!response.ok) throw new Error("Network response was not ok");
            const rawQuestions = await response.json();

            this.buildDynamicExam(rawQuestions);

            // Reset Exam State
            this.state.exam.currentIndex = 0;
            this.state.exam.timer = 7200; // 120 minutes
            this.state.exam.answers = {};
            this.state.exam.isPaused = false;

            this.switchView('view-exam');
            this.startTimer();
            this.renderQuestionCard();

        } catch (error) {
            console.error("Failed to load questions:", error);
            alert("Could not load questions.json. Ensure you are running via a local server (e.g., Live Server, http-server).");
        }
    },

    buildDynamicExam(data) {
        // Group by theme.id
        const grouped = {};
        data.forEach(q => {
            if (!grouped[q.theme.id]) grouped[q.theme.id] = { theme: q.theme, questions: [] };
            grouped[q.theme.id].questions.push(q);
        });

        let finalSet = [];
        // Pick random questions per theme based on pick_count
        for (let key in grouped) {
            let group = grouped[key];
            let shuffled = [...group.questions].sort(() => 0.5 - Math.random());
            finalSet.push(...shuffled.slice(0, group.theme.pick_count));
        }

        // Shuffle the final combined set
        this.state.exam.questions = finalSet.sort(() => 0.5 - Math.random());
        document.getElementById('exam-progress-total').textContent = this.state.exam.questions.length;
    },

    startTimer() {
        if (this.state.exam.intervalId) clearInterval(this.state.exam.intervalId);

        const updateDisplay = () => {
            const m = Math.floor(this.state.exam.timer / 60).toString().padStart(2, '0');
            const s = (this.state.exam.timer % 60).toString().padStart(2, '0');
            document.getElementById('exam-timer').textContent = `${m}:${s}`;
        };

        updateDisplay();
        this.state.exam.intervalId = setInterval(() => {
            if (!this.state.exam.isPaused) {
                this.state.exam.timer--;
                updateDisplay();
                if (this.state.exam.timer <= 0) {
                    clearInterval(this.state.exam.intervalId);
                    this.endExam();
                }
            }
        }, 1000);
    },

    togglePause(pause) {
        this.state.exam.isPaused = pause;
        const overlay = document.getElementById('pause-overlay');
        if (pause) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    },

    renderQuestionCard() {
        const index = this.state.exam.currentIndex;
        const q = this.state.exam.questions[index];
        const state = this.state.exam.answers[index]; // Previously answered state?

        document.getElementById('exam-progress-current').textContent = index + 1;
        document.getElementById('question-theme').textContent = q.theme.title;
        document.getElementById('question-text').textContent = q.question;

        const optsContainer = document.getElementById('question-options');
        optsContainer.innerHTML = '';

        const inputType = q.type === 'single_choice' ? 'radio' : 'checkbox';
        const isConfirmed = state && state.confirmed;

        q.options.forEach((optText, i) => {
            // Styling logic for instant feedback if already confirmed
            let customClass = "border-slate-700 hover:bg-slate-800";
            let checked = state && state.selected.includes(i) ? 'checked' : '';
            let disabled = isConfirmed ? 'disabled' : '';

            if (isConfirmed) {
                customClass = "border-slate-800 opacity-60"; // default muted
                const isCorrectOption = q.correct.includes(i);
                const isSelectedOption = state.selected.includes(i);

                if (isCorrectOption) {
                    customClass = "border-emerald-500 bg-emerald-900/20 text-emerald-200 opacity-100";
                } else if (isSelectedOption && !isCorrectOption) {
                    customClass = "border-rose-500 bg-rose-900/20 text-rose-200 opacity-100";
                }
            }

            optsContainer.innerHTML += `
                <label class="flex items-start p-4 border rounded-lg cursor-pointer transition ${customClass}">
                    <div class="flex-shrink-0 mt-0.5 mr-4">
                        <input type="${inputType}" name="exam-option" value="${i}" ${checked} ${disabled}
                            class="w-4 h-4 text-blue-600 bg-slate-900 border-slate-700 focus:ring-blue-500">
                    </div>
                    <span class="text-sm leading-snug">${optText}</span>
                </label>
            `;
        });

        // Update Button States
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnConfirm = document.getElementById('btn-confirm');

        btnPrev.disabled = index === 0;

        if (index === this.state.exam.questions.length - 1) {
            btnNext.textContent = 'Finish Exam';
            btnNext.classList.replace('bg-blue-600', 'bg-indigo-600');
            btnNext.classList.replace('hover:bg-blue-500', 'hover:bg-indigo-500');
        } else {
            btnNext.textContent = 'Next';
            btnNext.classList.replace('bg-indigo-600', 'bg-blue-600');
            btnNext.classList.replace('hover:bg-indigo-500', 'hover:bg-blue-500');
        }

        if (isConfirmed) {
            btnConfirm.disabled = true;
            btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btnConfirm.disabled = false;
            btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    },

    confirmAnswer() {
        const index = this.state.exam.currentIndex;
        if (this.state.exam.answers[index] && this.state.exam.answers[index].confirmed) return; // already locked

        const q = this.state.exam.questions[index];
        const inputs = document.querySelectorAll('input[name="exam-option"]:checked');

        if (inputs.length === 0) {
            alert("Please select an answer before confirming.");
            return;
        }

        const selected = Array.from(inputs).map(el => parseInt(el.value));

        // Evaluate Correctness
        const isCorrect = selected.length === q.correct.length && selected.every(val => q.correct.includes(val));

        this.state.exam.answers[index] = {
            confirmed: true,
            selected: selected,
            isCorrect: isCorrect
        };

        this.renderQuestionCard(); // re-render to apply feedback styling
    },

    navigateExam(dir) {
        const nextIdx = this.state.exam.currentIndex + dir;

        if (nextIdx < 0) return;
        if (nextIdx >= this.state.exam.questions.length) {
            this.endExam();
            return;
        }

        this.state.exam.currentIndex = nextIdx;
        this.renderQuestionCard();
    },

    endExam() {
        clearInterval(this.state.exam.intervalId);

        const total = this.state.exam.questions.length;
        let score = 0;

        for (let i = 0; i < total; i++) {
            if (this.state.exam.answers[i] && this.state.exam.answers[i].isCorrect) {
                score++;
            }
        }

        const percentage = Math.round((score / total) * 100);

        // Save History
        const now = new Date();
        const historyRecord = {
            score: score,
            total: total,
            percentage: percentage,
            date: now.toISOString().split('T')[0],
            time: now.toTimeString().split(' ')[0].slice(0, 5)
        };

        const userIndex = this.state.users.findIndex(u => u.username === this.state.currentUser.username);
        if(userIndex > -1) {
            this.state.users[userIndex].history.push(historyRecord);
            this.saveUsers();
        }

        // Render Results
        document.getElementById('result-score').textContent = score;
        document.getElementById('result-percent').textContent = `${percentage}%`;

        // Color logic for percentage
        const pNode = document.getElementById('result-percent');
        pNode.className = `text-5xl font-light ${percentage >= 70 ? 'text-emerald-400' : 'text-rose-400'}`;

        this.switchView('view-result');
    }
};

// Bootstrap application once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});