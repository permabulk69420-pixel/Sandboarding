// Every run in the game, in the order they appear. Add new ones here.
import ridgeline from './ridgeline.js';

export const COURSES = [ridgeline];
export const courseById = id => COURSES.find(c => c.id === id) || COURSES[0];
