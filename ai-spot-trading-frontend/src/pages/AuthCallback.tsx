import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader } from '../components/Loader';

export const AuthCallback = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    const processAuth = async () => {
      // Pega o código da URL (ex: ?code=xxx)
      const searchParams = new URLSearchParams(location.search);
      const code = searchParams.get('code');

      if (code) {
        // MOCK: Simulando chamada ao Backend .NET para trocar o código pelo UID e gravar chaves
        console.log("Enviando code para API .NET:", code);
        
        // Simula delay de rede
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Simula sucesso de login retornando um UID mockado
        const fakeUid = `BINANCE_UID_${Math.floor(Math.random() * 10000)}`;
        login(fakeUid);
      } else {
        // Falha ou cancelado, joga pra home
        navigate('/');
      }
    };

    processAuth();
  }, [location, login, navigate]);

  return (
    <Loader onLoadComplete={() => navigate('/dashboard')} />
  );
};
