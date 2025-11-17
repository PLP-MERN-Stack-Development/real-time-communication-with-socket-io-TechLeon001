const React = require('react');
const ReactDOM = require('react-dom/client');
const App = require('./App');
require('./App.css');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));